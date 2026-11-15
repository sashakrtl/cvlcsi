# Mettre à jour le site CVL sur GitHub et Netlify

1. Téléchargez et décompressez `site-cvl-netlify.zip`.
2. Ouvrez le dépôt GitHub `sashakrtl/cvlcsi`, puis **Add file → Upload files**.
3. Depuis le dossier décompressé, ajoutez à la racine du dépôt les éléments `netlify/`, `public/`, `netlify.toml`, `package.json` et les fichiers `.md`. Il faut conserver `public/index.html` et `netlify/functions/cvl.mjs` à ces emplacements. Le logo reste dans `public/logo-cvl.jpg`.
4. Choisissez **Commit changes** sur la branche `main`. Netlify publiera automatiquement le nouveau déploiement.
5. Dans Netlify, vérifiez que le déploiement est marqué **Published**. Les variables `CVL_ADMIN_PASSWORD` et `CVL_SESSION_SECRET` déjà enregistrées dans Netlify restent en place.
6. Sur le site, connectez-vous à « Se connecter » pour ajouter des actualités avec photo/PDF, des comptes rendus, des projets et les éditions de « Journal L’intersection ».

Le ZIP contient l’application complète afin que la fonction Netlify et la page du site soient mises à jour ensemble. Ne déposez pas le contenu de `public/` directement à la racine du dépôt : gardez le dossier `public/`.
