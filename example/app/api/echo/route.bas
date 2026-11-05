' example/app/api/echo/route.bas
' POST /api/echo  {"message": "BASIC", "count": 3}
' For POST, Req is filled from the JSON body.

TYPE Request
    message AS STRING * 200
    count   AS INTEGER
END TYPE

TYPE Response
    result  AS STRING * 4000
    repeats AS INTEGER
END TYPE

SUB OnPost
    DIM n AS INTEGER
    DIM idx AS INTEGER
    DIM joined AS STRING

    IF RTRIM$(Req.message) = "" THEN Fail 400, "message is required"

    n = Req.count
    IF n < 1 THEN n = 1
    IF n > 10 THEN n = 10

    joined = ""
    FOR idx = 1 TO n
        IF idx > 1 THEN joined = joined + " "
        joined = joined + RTRIM$(Req.message)
    NEXT idx

    Resp.result  = joined
    Resp.repeats = n
END SUB
