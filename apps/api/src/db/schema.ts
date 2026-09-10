/**
 * L'agrégateur de schéma — et rien d'autre.
 *
 * ATEM-old déclarait ses 21 tables dans un fichier de 780 lignes mêlant six
 * domaines. Chaque table y était saine ; c'est leur cohabitation qui a permis à
 * trois modules d'écrire dans les tables du catalogue, chacun avec sa propre
 * logique, sans connaître les deux autres.
 *
 * Ici il n'y a rien à écrire : chaque module possède ses tables, ce fichier ne
 * fait que les réunir pour drizzle-kit. Il ne peut pas grossir.
 */
export * from "../modules/identity/schema.js";
export * from "../modules/referential/schema.js";
export * from "../modules/collection/schema.js";
