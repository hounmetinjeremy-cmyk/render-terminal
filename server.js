// render-terminal — serveur MCP (Render) exposant un terminal shell persistant
// + un outil pour pousser directement du code sur GitHub (evite de garder le code en memoire).

import express from "express";
import { exec } from "child_process";

const PORT = process.env.PORT || 10000;
const MAX_OUT = 50000;
const EXEC_TIMEOUT_MS = 25000;
const MAX_BUFFER = 5 * 1024 * 1024; // 5 Mo

const app = express();
app.use(express.json({ limit: "10mb" }));

function clip(s) {
  s = String(s ?? "");
  return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n...[tronque]" : s;
}

function terminalRun({ command, cwd }) {
  return new Promise((resolve) => {
    if (!command) return resolve({ isError: true, text: "Parametre 'command' manquant." });
    exec(command, { cwd: cwd || process.cwd(), timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      let text = `--- sortie ---\n${clip(stdout)}`;
      if (stderr) text += `\n--- stderr ---\n${clip(stderr)}`;
      text += `\n--- code retour: ${err ? (err.code ?? 1) : 0} ---`;
      resolve({ text, isError: !!err && err.killed });
    });
  });
}

async function pushCode({ owner, repo, path, content, message, branch }) {
  if (!process.env.GITHUB_TOKEN) return { isError: true, text: "Secret manquant : GITHUB_TOKEN." };
  if (!owner || !repo || !path || content === undefined) {
    return { isError: true, text: "owner, repo, path et content sont requis." };
  }
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "render-terminal"
  };

  // Recuperer le sha si le fichier existe deja (pour une mise a jour)
  let sha;
  const getRes = await fetch(`${base}${branch ? `?ref=${branch}` : ""}`, { headers });
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha;
  }

  const body = {
    message: message || `Update ${path}`,
    content: Buffer.from(content, "utf-8").toString("base64"),
    ...(sha ? { sha } : {}),
    ...(branch ? { branch } : {})
  };

  const putRes = await fetch(base, { method: "PUT", headers, body: JSON.stringify(body) });
  const data = await putRes.json().catch(() => ({}));
  if (!putRes.ok) {
    return { isError: true, text: `Erreur GitHub ${putRes.status}: ${JSON.stringify(data).slice(0, 400)}` };
  }
  return { text: `Fichier ${path} pousse sur ${owner}/${repo} (commit ${data.commit?.sha?.slice(0, 7) || "?"}).` };
}

const TOOLS = [
  {
    name: "terminal_run",
    description: "Execute une commande shell directement sur le serveur Render (persistant, pas de demarrage de conteneur a chaque appel).",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Commande shell a executer." },
        cwd: { type: "string", description: "Repertoire de travail (optionnel)." }
      },
      required: ["command"]
    },
    run: terminalRun
  },
  {
    name: "push_code",
    description: "Pousse un fichier de code directement vers un depot GitHub (commit), au lieu de le garder en memoire sur le serveur.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Proprietaire du depot GitHub." },
        repo: { type: "string", description: "Nom du depot GitHub." },
        path: { type: "string", description: "Chemin du fichier dans le depot." },
        content: { type: "string", description: "Contenu complet du fichier." },
        message: { type: "string", description: "Message de commit (optionnel)." },
        branch: { type: "string", description: "Branche cible (optionnel, defaut: branche par defaut)." }
      },
      required: ["owner", "repo", "path", "content"]
    },
    run: pushCode
  }
];

function jsonRpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function jsonRpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

function checkAuth(req) {
  if (!process.env.MCP_AUTH_TOKEN) return true;
  return (req.headers["authorization"] || "") === `Bearer ${process.env.MCP_AUTH_TOKEN}`;
}

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `Outil inconnu: ${name}` }], isError: true };
  try {
    const r = await tool.run(args || {});
    return { content: [{ type: "text", text: r.text }], isError: !!r.isError };
  } catch (e) {
    return { content: [{ type: "text", text: `Erreur: ${e.message || e}` }], isError: true };
  }
}

app.get("/", (req, res) => {
  res.send("render-terminal: OK. Endpoint MCP : POST /mcp");
});

app.post("/mcp", async (req, res) => {
  if (!checkAuth(req)) return res.status(401).send("Unauthorized");
  const { id, method, params } = req.body || {};

  if (method === "initialize") {
    return res.json(jsonRpcResult(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "render-terminal", version: "1.0.0" }
    }));
  }
  if (method === "notifications/initialized") return res.status(202).end();
  if (method === "tools/list") return res.json(jsonRpcResult(id, { tools: TOOLS.map(({ run, ...t }) => t) }));
  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    const result = await callTool(name, args);
    return res.json(jsonRpcResult(id, result));
  }
  return res.json(jsonRpcError(id, -32601, `Methode inconnue: ${method}`));
});

app.listen(PORT, () => console.log(`render-terminal en ecoute sur le port ${PORT}`));
