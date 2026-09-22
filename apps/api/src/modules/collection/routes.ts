import { Hono } from "hono";
import { z } from "zod";
import {
  buildCollectionCsv, CSV_EXPORT_FORMATS, isCsvExportFormat, LIMITS, parseCollectionFile,
} from "@atem/shared";
import type { Database } from "../../db/client.js";
import { invalidInput } from "../../platform/errors.js";
import { requireRowId } from "../../platform/identifiers.js";
import { requireViewer } from "../identity/index.js";
import { collectionQuery } from "./query.js";
import {
  adjustQuantity, clearCollection, collectionFacets, exportLines, importCollection, listCollection,
  listImports,
  resolveStatus,
  setFavorite,
  setNotes,
} from "./service.js";

const AdjustBody = z.object({
  setCode: z.string().min(1).max(LIMITS.setCode.max),
  delta: z.number().int().min(-LIMITS.quantity.max).max(LIMITS.quantity.max),
  language: z.string().max(5).nullish(),
  /**
   * The passcode, when known: the eight digits at the bottom left of the card.
   * When it is provided, the printing does not have to wait to be identified —
   * we already know which card it is.
   */
  passcode: z.number().int().positive().nullish(),
});

export function collectionRoutes(db: Database) {
  const app = new Hono();
  app.use("*", requireViewer);

  const viewerId = (c: { get: (key: "viewer") => { id: string } | null }): string => {
    const viewer = c.get("viewer");
    if (!viewer) throw invalidInput("No session.");
    return viewer.id;
  };

  app.get("/", async (c) => c.json(await listCollection(db, viewerId(c), collectionQuery(c.req.query()))));

  app.get("/facets", async (c) => c.json(await collectionFacets(db, viewerId(c))));

  app.get("/resolve-status", async (c) => c.json(await resolveStatus(db, viewerId(c))));

  /** The “+1” and “−1” of the scanner as of the grid. */
  app.post("/adjust", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw invalidInput("Unreadable request body.");
    }
    const parsed = AdjustBody.safeParse(raw);
    if (!parsed.success) throw invalidInput("Invalid data.", { issues: parsed.error.issues });

    return c.json({ item: await adjustQuantity(db, viewerId(c), parsed.data) });
  });

  app.patch("/:id/notes", async (c) => {
    const id = requireRowId(c.req.param("id"));

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw invalidInput("Unreadable request body.");
    }
    const parsed = z
      .object({ notes: z.string().max(LIMITS.note.max).nullable() })
      .safeParse(raw);
    if (!parsed.success) throw invalidInput("Invalid data.");

    await setNotes(db, viewerId(c), id, parsed.data.notes);
    return c.json({ ok: true });
  });

  app.patch("/:id/favorite", async (c) => {
    const id = requireRowId(c.req.param("id"));

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw invalidInput("Unreadable request body.");
    }
    const parsed = z.object({ isFavorite: z.boolean() }).safeParse(raw);
    if (!parsed.success) throw invalidInput("Invalid data.");

    await setFavorite(db, viewerId(c), id, parsed.data.isFavorite);
    return c.json({ ok: true });
  });

  /**
   * The collection as a CSV file, in one of the three formats.
   *
   * The BOM is written **here**, by the server, not by the page that links to
   * it. The earlier prototype added it in the browser, so a direct link to the export gave a
   * file that Excel in a French locale read as latin-1, accents mangled
   * (`docs/ref-csv-formats.md`). The builder writes content only, so a preview
   * does not show one; the download is what needs it.
   */
  app.get("/export", async (c) => {
    const format = c.req.query("format") ?? "atem";
    if (!isCsvExportFormat(format)) throw invalidInput("Unknown export format.");
    const spec = CSV_EXPORT_FORMATS.find((candidate) => candidate.id === format)!;

    const csv = buildCollectionCsv(format, await exportLines(db, viewerId(c)));
    return c.body(`\uFEFF${csv}`, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${spec.filename}"`,
      // A collection is personal: no shared cache may keep a copy of it.
      "Cache-Control": "private, no-store",
    });
  });

  /**
   * Imports a collection file — CSV or a JSON scanlist export — as the raw body.
   *
   * The size is checked **twice**, as the reference requires: on the announced
   * `Content-Length` to refuse early, then on the text actually read, because the
   * header can lie, or be absent with a chunked body. The application-wide limit
   * is 6 MB, so a 5 MB file reaches this route rather than dying before it.
   *
   * The body is text rather than JSON wrapping the file: wrapping would escape
   * every quote and line break in a CSV for nothing.
   */
  app.post("/import", async (c) => {
    const mode = c.req.query("mode") ?? "merge";
    if (mode !== "merge" && mode !== "replace") throw invalidInput("Unknown import mode.");

    const announced = Number(c.req.header("Content-Length") ?? "0");
    if (announced > LIMITS.csvImport.maxBytes) throw invalidInput("The file is too large (5 MB at most).");
    const text = await c.req.text();
    if (new TextEncoder().encode(text).length > LIMITS.csvImport.maxBytes) {
      throw invalidInput("The file is too large (5 MB at most).");
    }

    // The name is only shown back in the history: bounded, and never trusted as a path.
    const filename = (c.req.query("filename") ?? "").trim().slice(0, 255) || "import";
    const parsed = parseCollectionFile(text);
    return c.json(await importCollection(db, viewerId(c), parsed, mode, filename));
  });

  /** The recent imports, for the settings' history. */
  app.get("/imports", async (c) => c.json({ items: await listImports(db, viewerId(c)) }));

  /**
   * Erases the whole collection.
   *
   * A `DELETE` on the collection itself rather than a loop of `DELETE /:id`:
   * see `clearCollection`. The confirmation is the screen's job — a typed word
   * and a delay to cancel — because by the time this is called, the person has
   * already been asked twice.
   */
  app.delete("/", async (c) => {
    const removed = await clearCollection(db, viewerId(c));
    return c.json({ removed });
  });

  return app;
}
