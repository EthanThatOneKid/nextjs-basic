' example/app/api/hello/route.bas
' User writes FUNCTION RunRoute$ which dispatches on method.
' gReq and gResp are shared globals from runtime.bas.
' glue_* shared vars are from route.glue.bas.

TYPE HelloBody
    name AS STRING * 50
END TYPE

TYPE HelloResult
    message  AS STRING * 100
    language AS STRING * 20
END TYPE

FUNCTION RunRoute$ (meth AS STRING)
    IF meth = "GET" THEN
        ParseHelloBody RTRIM$(gReq.bodyJson)

        IF RTRIM$(glue_HelloBody.name) = "" THEN glue_HelloBody.name = Query$("name")
        IF RTRIM$(glue_HelloBody.name) = "" THEN glue_HelloBody.name = "World"

        glue_HelloResult.message  = "Hello, " + RTRIM$(glue_HelloBody.name) + "! Greetings from QB64 BASIC."
        glue_HelloResult.language = "QB64 BASIC"

        gResp.statusCode = 200
        RunRoute$ = WriteHelloResult$
    ELSE
        gResp.statusCode = 405
        RunRoute$ = "{" + CHR$(34) + "error" + CHR$(34) + ":" + CHR$(34) + "Method Not Allowed" + CHR$(34) + "}"
    END IF
END FUNCTION


