# Plan de migration des avis npm

Aucune mise à niveau n'a été appliquée le 18 octobre 2026. Le registre npm a été consulté. Il n'existe pas de correctif compatible qui garde Next.js 15 et Prisma 6.

## postcss 8.4.31, via next 15.5.27 — production

Next.js 15.5.27 embarque `postcss@8.4.31`. L'avis couvre `postcss <= 8.5.22`. `next@15.5.28`, dernière version 15.5 publiée, embarque encore `postcss@8.4.31`. Il n'y a pas de Next.js 15.6 stable. Le forcer vers `next@16.4.2` change le framework.

Étapes, dans une branche séparée :

1. Monter Next.js vers la version 15 qui embarque `postcss` corrigé, si elle existe. Sinon, prévoir Next.js 16.
2. Lancer `npm run typecheck`, `npm run lint`, `npm test` et `npm run build`.
3. Ouvrir les pages de connexion, d'inscription, le tableau de bord et une page de facturation.
4. Ne pas utiliser `npm audit fix --force`.

## deepmerge-ts 7.1.5, via @prisma/config 6.19.3 et prisma 6.19.3 — outil Prisma, pas le client des requêtes

`prisma@6.19.3` est la dernière version 6 publiée. Elle dépend de `@prisma/config@6.19.3`, qui dépend de `deepmerge-ts@7.1.5`. L'avis demande `deepmerge-ts >= 8`. `npm audit` propose `prisma@6.12.0`, une rétrogradation. Elle n'a pas été appliquée.

Étapes :

1. Attendre un Prisma 6 qui dépend de `deepmerge-ts` 8, ou un correctif de `@prisma/config`.
2. Appliquer cette mise à jour seule, puis `npx prisma generate`, `npm test` et `npm run build`.
3. Ne pas changer le schéma pour faire disparaître l'avis.

## tinypool 1.1.1, via vitest 3.2.7 — développement et tests seulement

`npm ls tinypool` ne le montre que sous Vitest. Aucun fichier de l'application ne l'importe. `vitest@3.2.7` est la dernière version 3, et elle dépend encore de `tinypool@^1.1.1`. Le correctif annoncé est Vitest 5. Ce n'est pas une dépendance de production.

Étapes :

1. Monter Vitest vers 5 dans une branche séparée.
2. Relire `vitest.config.ts` et les tests qui dépendent de l'API de la version 3.
3. Lancer `npm test` jusqu'à ce que la suite passe.
4. Ne pas ajouter `tinypool` aux dépendances de production.
