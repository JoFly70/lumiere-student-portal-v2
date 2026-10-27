import express, { type Express } from "express";

/** Keep request allocations bounded before validation; preserve raw webhook bytes. */
export function configureRequestBody(app: Express) {
  // Only staff roadmap import endpoints accept the larger structured packages.
  const parser = (limit: string) => express.json({
    limit,
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  });
  const ordinaryJson = parser("100kb");
  const roadmapJson = parser("2mb");
  // Select exactly one parser: a second JSON parser can reapply its smaller
  // content-length limit even after the roadmap parser has consumed the body.
  app.use((req, res, next) => {
    const json = /^\/api\/admin\/students\/[^/]+\/roadmap(\/|$)/.test(req.path) ? roadmapJson : ordinaryJson;
    json(req, res, next);
  });
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
}
