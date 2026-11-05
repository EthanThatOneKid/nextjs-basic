' example/app/api/status/route.bas
' A health check that browsers on other origins may call.
'
'   GET     returns {"status":"ok"} with CORS and Cache-Control headers
'   HEAD    returns only the status code and headers (the body is dropped)
'   OPTIONS answers the browser's CORS preflight with 204
'
' SetHeader adds a response header. AllowCors adds the CORS headers for this route's
' methods. A browser preflight is an OPTIONS request, which needs its own handler.

TYPE Response
    status AS STRING * 10
END TYPE

SUB OnGet
    SetHeader "Cache-Control", "no-store"
    AllowCors "*"
    Resp.status = "ok"
END SUB

SUB OnHead
    AllowCors "*"
    Respond 200
END SUB

SUB OnOptions
    AllowCors "*"
    Respond 204
END SUB
