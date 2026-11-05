' example/app/api/hello/route.bas
' GET /api/hello?name=Ada
' For GET, Req is filled from the query string. Resp is sent back as JSON.

TYPE Request
    name AS STRING * 50
END TYPE

TYPE Response
    message  AS STRING * 100
    language AS STRING * 20
END TYPE

SUB OnGet
    IF RTRIM$(Req.name) = "" THEN Req.name = "World"

    Resp.message  = "Hello, " + RTRIM$(Req.name) + "! Greetings from QB64 BASIC."
    Resp.language = "QB64 BASIC"
END SUB
