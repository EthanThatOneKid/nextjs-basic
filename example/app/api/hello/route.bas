' example/app/api/hello/route.bas
' This is the ONLY file the user writes.
' ParseHelloBody and WriteHelloResult are generated automatically.

TYPE HelloBody
    name AS STRING * 50
END TYPE

TYPE HelloResult
    message  AS STRING * 100
    language AS STRING * 20
END TYPE

FUNCTION GET (req AS Request, resp AS Response)
    DIM body AS HelloBody
    DIM result AS HelloResult

    ParseHelloBody req, body

    result.message  = "Hello, " + RTRIM$(body.name) + "! Greetings from QB64 BASIC."
    result.language = "QB64 BASIC"

    WriteHelloResult result, resp
    resp.statusCode = 200
END FUNCTION
