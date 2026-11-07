# Demo screencast script

About two minutes. Load the live demo once just before recording: it sleeps when idle, and the first request can take several seconds.

Live demo: https://nextjs-basic-demo-cy26xih5na-uc.a.run.app/api/hello?name=Ada

| Time | Show | Say |
|---|---|---|
| 0:00 | `example/app/api/hello/route.bas` in the editor | "This is a Next.js API route, written in BASIC." |
| 0:15 | The `OnGet` SUB | "I read the query, I set the reply, and that is all." |
| 0:30 | The live URL in a browser | "The same route, running on Google Cloud Run. It returns real JSON." |
| 0:45 | `curl -i -X OPTIONS` on `/api/status` in a terminal | "Headers and CORS work too." |
| 1:00 | The `Fail` call in `echo`, then a bad POST | "A failure turns into an HTTP error code." |
| 1:15 | The generated `route.types.ts` | "The TypeScript types come from the BASIC types." |
| 1:30 | `.kiro/specs`, then the green CI page | "Kiro helped design it, and CI tests it on three systems." |
| 1:50 | The repo page | "It is called nextjs-basic. Thank you." |

To check the demo before recording: `bash scripts/check-routes.sh https://nextjs-basic-demo-cy26xih5na-uc.a.run.app`
