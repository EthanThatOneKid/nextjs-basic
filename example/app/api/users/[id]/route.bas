' example/app/api/users/[id]/route.bas
' GET /api/users/42?verbose=1
' Param$, Query$ and Header$ read the dynamic segment, query string and headers.
' There is no Request type here, so only Resp is used.

TYPE Response
    id      AS STRING * 50
    verbose AS STRING * 10
    agent   AS STRING * 200
END TYPE

SUB OnGet
    IF Param$("id") = "0" THEN Fail 404, "user not found"

    Resp.id      = Param$("id")
    Resp.verbose = Query$("verbose")
    Resp.agent   = Header$("user-agent")
END SUB
