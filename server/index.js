import { createApp } from './app.js';
import { ensureAdmin } from './seed.js';

const port = Number(process.env.PORT) || 3000;
const { app, db } = createApp();
ensureAdmin(db);

const server = app.listen(port, () => {
  console.log(`Cine LibroSeller Studios escuchando en http://localhost:${port}  (panel: /studio)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => { db.close(); process.exit(0); });
  });
}
