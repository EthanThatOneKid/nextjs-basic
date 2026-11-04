' example/app/api/echo/route.bas
' POST example: accepts a message and count, returns the message repeated.

TYPE EchoRequest
    message AS STRING * 200
    count   AS INTEGER
END TYPE

TYPE EchoResponse
    result  AS STRING * 4000
    repeats AS INTEGER
END TYPE

FUNCTION RunRoute$ (meth AS STRING)
    IF meth = "POST" THEN
        ParseEchoRequest RTRIM$(gReq.bodyJson)

        DIM msg AS STRING
        DIM n AS INTEGER
        DIM idx AS INTEGER
        DIM outStr AS STRING

        msg = RTRIM$(glue_EchoRequest.message)
        n = glue_EchoRequest.count

        IF n < 1 THEN n = 1
        IF n > 10 THEN n = 10

        outStr = ""
        FOR idx = 1 TO n
            IF idx > 1 THEN outStr = outStr + " "
            outStr = outStr + msg
        NEXT idx

        glue_EchoResponse.result  = outStr
        glue_EchoResponse.repeats = n

        gResp.statusCode = 200
        RunRoute$ = WriteEchoResponse$
    ELSE
        gResp.statusCode = 405
        RunRoute$ = "{" + CHR$(34) + "error" + CHR$(34) + ":" + CHR$(34) + "Method Not Allowed" + CHR$(34) + "}"
    END IF
END FUNCTION


