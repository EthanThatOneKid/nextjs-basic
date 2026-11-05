' example/app/api/users/[id]/route.bas
' Dynamic segment example: GET /api/users/42?verbose=1
' Param$, Query$ and Header$ read the dynamic segment, query string and request headers.

TYPE UserResult
    id      AS STRING * 50
    verbose AS STRING * 10
    agent   AS STRING * 200
END TYPE

FUNCTION RunRoute$ (meth AS STRING)
    IF meth = "GET" THEN
        glue_UserResult.id      = Param$("id")
        glue_UserResult.verbose = Query$("verbose")
        glue_UserResult.agent   = Header$("user-agent")

        gResp.statusCode = 200
        RunRoute$ = WriteUserResult$
    ELSE
        gResp.statusCode = 405
        RunRoute$ = "{" + CHR$(34) + "error" + CHR$(34) + ":" + CHR$(34) + "Method Not Allowed" + CHR$(34) + "}"
    END IF
END FUNCTION
