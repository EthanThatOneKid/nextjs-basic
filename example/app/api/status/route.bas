' example/app/api/status/route.bas
' A health check: GET /api/status returns JSON, HEAD /api/status returns only the
' status code (the shim drops the body for HEAD), OPTIONS answers 204.
' Without OnOptions, Next.js answers OPTIONS itself with an Allow header.

TYPE Response
    status AS STRING * 10
END TYPE

SUB OnGet
    Resp.status = "ok"
END SUB

SUB OnHead
    Respond 200
END SUB

SUB OnOptions
    Respond 204
END SUB
