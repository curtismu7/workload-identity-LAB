import { createApp } from './app.js';
const PORT = Number(process.env.PORT || 7816);
const app = createApp();
app.listen(PORT, '0.0.0.0', () => console.log(`[workload-identity-lab] listening on 0.0.0.0:${PORT}`));
