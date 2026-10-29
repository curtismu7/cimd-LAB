import { createApp } from './app.js';

const port = Number(process.env.PORT || 5250);
const hosted = process.env.MODE === 'hosted';
if (hosted && !process.env.PUBLIC_HOST) {
  console.error('MODE=hosted needs PUBLIC_HOST (the exact host name visitors use)');
  process.exit(1);
}
// Local: loopback only, the server never faces a network. Hosted (MODE=hosted, the SE build): bind all interfaces
// behind the ingress; only loopback hosts and PUBLIC_HOST are accepted in the Host header.
const app = createApp({ port });
// BIND=0.0.0.0 is for the container only: compose publishes 127.0.0.1:5250 on the host, so it stays loopback there.
const bind = hosted || process.env.BIND === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
app.listen(port, bind, () => {
  console.log(`CIMD Lab on ${bind}:${port}${hosted ? ` (hosted, ${process.env.PUBLIC_HOST})` : ''}`);
});
