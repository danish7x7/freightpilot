import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 8082);

app
  .listen({ port, host: "0.0.0.0" })
  .then((address) => app.log.info(`agent-service listening on ${address}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
