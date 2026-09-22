# render-terminal

Serveur MCP (Node/Express, deploye sur Render) exposant :

- `terminal_run` : execute une commande shell directement sur le serveur (persistant, pas de redemarrage de conteneur a chaque appel).
- `push_code` : pousse un fichier de code directement vers un depot GitHub via l'API GitHub, au lieu de le garder en memoire sur le serveur.

## Variables d'environnement (secrets Render)

- `GITHUB_TOKEN` : Personal Access Token GitHub (scope `repo`) pour l'outil `push_code`.
- `MCP_AUTH_TOKEN` : token pour proteger l'endpoint `/mcp` (Authorization: Bearer ...).

## Endpoint

`POST /mcp` — protocole MCP standard (`initialize`, `tools/list`, `tools/call`).
