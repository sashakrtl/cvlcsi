# Mise en ligne du CVL avec enregistrement partagé

Cette version utilise une fonction Netlify et Netlify Blobs. Le contenu public, les propositions privées et les PDF sont conservés côté serveur. Les fonctions doivent être déployées depuis un dépôt Git (le dépôt manuel de fichiers statiques ne les construit pas).

## 1. Préparer les fichiers

Garder `package.json`, `netlify.toml`, `public/` et `netlify/` ensemble à la racine du projet. Le dossier `public/` contient les fichiers visibles du site; `netlify/functions/` contient la fonction serveur.

## 2. Relier le projet Netlify à GitHub

Dans Netlify, ouvrir le projet actuel, puis aller à **Project configuration → Developer settings → Continuous deployment → Repository**. Choisir **Push to new repository**, autoriser GitHub et terminer l’assistant. Dans le dépôt GitHub créé, remplacer/ajouter les fichiers avec ceux du ZIP, en conservant les dossiers `public/` et `netlify/` à la racine. Netlify peut ainsi construire et publier les fonctions du projet.

Si le projet ne propose pas **Push to new repository**, créer un dépôt GitHub avec les fichiers ci-dessus, puis dans Netlify choisir **Add new project → Import an existing project** et sélectionner ce dépôt.

## 3. Ajouter les secrets Netlify

Dans Netlify, ouvrir **Project configuration → Environment variables** et ajouter :

- `CVL_ADMIN_PASSWORD` : le mot de passe d’administration souhaité.
- `CVL_SESSION_SECRET` : une longue chaîne aléatoire secrète (au moins 32 caractères).

Ne pas écrire ces valeurs dans `index.html`, `package.json` ou un dépôt public. Après les avoir ajoutées, déclencher un nouveau déploiement.

## 4. Vérifier

Une fois le déploiement terminé, ouvrir l’adresse publique du site, se connecter, publier une actualité de test, puis ouvrir le site dans une fenêtre privée ou sur un autre appareil. L’actualité doit apparaître. Supprimer ensuite l’actualité de test.

Les changements déjà enregistrés dans l’ancien navigateur ne sont pas transférés automatiquement : ils doivent être ajoutés une nouvelle fois dans l’espace CVL.
