export default function Home() {
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>nextjs-basic example</h1>
      <p>QB64 BASIC routes running behind Next.js.</p>
      <ul>
        <li><a href="/api/hello">/api/hello</a> — GET, returns a greeting from BASIC</li>
        <li><code>POST /api/echo</code> — echoes a message N times</li>
      </ul>
      <h2>Try it</h2>
      <pre>{`# Hello route
curl http://localhost:3000/api/hello

# Echo route
curl -X POST http://localhost:3000/api/echo \\
  -H "Content-Type: application/json" \\
  -d '{"message":"BASIC","count":3}'`}</pre>
    </main>
  );
}
