import { createApp } from './app.js';

const port = Number(process.env.PORT || 5250);
// Loopback only: the tester and the fixtures use the lab's own address, and the server never faces a network.
const app = createApp({ port });
app.listen(port, '127.0.0.1', () => {
  console.log(`CIMD Lab on http://127.0.0.1:${port}`);
});
