' runtime.bas — nextjs-basic framework STDIO loop
$CONSOLE:ONLY
' Concatenated BEFORE route.bas and route.glue.bas at compile time.
'
' What a route file gets (see docs/writing-routes.md):
'   TYPE Request / TYPE Response   optional; Req and Resp are the shared variables
'   SUB OnGet, OnPost, OnPut, OnDelete, OnPatch, OnHead, OnOptions   one per supported method
'   Ctx                            method, path, raw JSON of body/query/headers/params
'   Query$, Header$, Param$        read the query string, headers, dynamic segments
'   Respond code                   set the HTTP status (default 200)
'   Fail code, "message"           stop the handler and send {"error": "message"}
'
' QB64 rules applied here:
'   - No names starting with an underscore
'   - Main module code MUST come before SUB/FUNCTION definitions
'   - No user-defined TYPE variables as SUB/FUNCTION parameters

' ---------------------------------------------------------------------------
' Framework envelope types
' ---------------------------------------------------------------------------

TYPE Context
    method      AS STRING * 8
    path        AS STRING * 255
    bodyJson    AS STRING * 4096
    reqId       AS STRING * 36
    endpoint    AS STRING * 64
    queryJson   AS STRING * 2048
    headersJson AS STRING * 4096
    paramsJson  AS STRING * 1024
END TYPE

TYPE Reply
    statusCode AS INTEGER
    bodyJson   AS STRING * 4096
    reqId      AS STRING * 36
END TYPE

' ---------------------------------------------------------------------------
' Shared state
' ---------------------------------------------------------------------------

DIM SHARED Ctx AS Context
DIM SHARED gReply AS Reply
DIM SHARED gFailed AS INTEGER
DIM SHARED gFailCode AS INTEGER
DIM SHARED gFailMsg AS STRING

' ---------------------------------------------------------------------------
' Main STDIO loop: one JSON request line in, one JSON response line out
' ---------------------------------------------------------------------------

DIM reqLine AS STRING
DIM methStr AS STRING

ON ERROR GOTO onRuntimeError

DO
    LINE INPUT reqLine
    IF reqLine = "" THEN _CONTINUE
    IF LEFT$(reqLine, 7) = "{" + CHR$(34) + "_quit" THEN SYSTEM

    Ctx.reqId       = JStr$(reqLine, "_id")
    Ctx.method      = JStr$(reqLine, "method")
    Ctx.path        = JStr$(reqLine, "path")
    Ctx.bodyJson    = JStr$(reqLine, "bodyJson")
    Ctx.endpoint    = JStr$(reqLine, "endpoint")
    Ctx.queryJson   = JStr$(reqLine, "queryJson")
    Ctx.headersJson = JStr$(reqLine, "headersJson")
    Ctx.paramsJson  = JStr$(reqLine, "paramsJson")

    gFailed = 0
    gFailCode = 500
    gFailMsg = ""
    gReply.statusCode = 200
    gReply.bodyJson   = "{}"
    gReply.reqId      = Ctx.reqId

    methStr = UCASE$(RTRIM$(Ctx.method))

    GluePrepare methStr
    GlueDispatch methStr
    gReply.bodyJson = GlueFinish$

afterCall:
    IF gFailed THEN
        gReply.statusCode = gFailCode
        gReply.bodyJson = "{" + CHR$(34) + "error" + CHR$(34) + ":" + CHR$(34) + JEn$(gFailMsg) + CHR$(34) + "}"
    END IF

    PRINT BldResp$(RTRIM$(gReply.reqId), gReply.statusCode, RTRIM$(gReply.bodyJson))
    _DELAY 0
LOOP

SYSTEM

' Fail raises error 250 to leave the handler; other runtime errors become a
' 400/500 response instead of killing the process. QB64 cannot detect a closed
' stdin, so the host ends the process with {"_quit":true} or by killing it.
onRuntimeError:
SELECT CASE ERR
    CASE 250
        ' raised by Fail, state already set
    CASE 62
        SYSTEM
    CASE 6
        gFailed = -1
        gFailCode = 400
        gFailMsg = "Number out of range"
    CASE ELSE
        gFailed = -1
        gFailCode = 500
        gFailMsg = "Internal error" + STR$(ERR)
END SELECT
RESUME afterCall

' ---------------------------------------------------------------------------
' Handler API
' ---------------------------------------------------------------------------

SUB Respond (code AS INTEGER)
    gReply.statusCode = code
END SUB

SUB Fail (code AS INTEGER, msg AS STRING)
    gFailed = -1
    gFailCode = code
    gFailMsg = msg
    ERROR 250
END SUB

FUNCTION Query$ (kn AS STRING)
    Query$ = JStr$(RTRIM$(Ctx.queryJson), kn)
END FUNCTION

FUNCTION Header$ (kn AS STRING)
    Header$ = JStr$(RTRIM$(Ctx.headersJson), LCASE$(kn))
END FUNCTION

FUNCTION Param$ (kn AS STRING)
    Param$ = JStr$(RTRIM$(Ctx.paramsJson), kn)
END FUNCTION

' ---------------------------------------------------------------------------
' JSON helper functions
' ---------------------------------------------------------------------------

' String value of a top-level key ("" if missing or not a string)
FUNCTION JStr$ (jsonIn AS STRING, kn AS STRING)
    DIM srchKey AS STRING
    DIM jPos AS LONG
    DIM jStart AS LONG
    DIM jEnd AS LONG
    DIM jCh AS STRING

    srchKey = CHR$(34) + kn + CHR$(34) + ":"
    jPos = INSTR(jsonIn, srchKey)
    IF jPos = 0 THEN JStr$ = "": EXIT FUNCTION

    jStart = jPos + LEN(srchKey)
    DO WHILE MID$(jsonIn, jStart, 1) = " "
        jStart = jStart + 1
    LOOP

    IF MID$(jsonIn, jStart, 1) <> CHR$(34) THEN JStr$ = "": EXIT FUNCTION

    jStart = jStart + 1
    jEnd = jStart
    DO WHILE jEnd <= LEN(jsonIn)
        jCh = MID$(jsonIn, jEnd, 1)
        IF jCh = CHR$(34) THEN EXIT DO
        IF jCh = "\" THEN jEnd = jEnd + 1
        jEnd = jEnd + 1
    LOOP

    JStr$ = JUn$(MID$(jsonIn, jStart, jEnd - jStart))
END FUNCTION

' Scalar value of a top-level key as text: "3" and 3 both give 3
FUNCTION JVal$ (jsonIn AS STRING, kn AS STRING)
    DIM srchKey AS STRING
    DIM jPos AS LONG
    DIM jStart AS LONG
    DIM jEnd AS LONG
    DIM jCh AS STRING

    srchKey = CHR$(34) + kn + CHR$(34) + ":"
    jPos = INSTR(jsonIn, srchKey)
    IF jPos = 0 THEN JVal$ = "": EXIT FUNCTION

    jStart = jPos + LEN(srchKey)
    DO WHILE MID$(jsonIn, jStart, 1) = " "
        jStart = jStart + 1
    LOOP

    IF MID$(jsonIn, jStart, 1) = CHR$(34) THEN JVal$ = JStr$(jsonIn, kn): EXIT FUNCTION

    jEnd = jStart
    DO WHILE jEnd <= LEN(jsonIn)
        jCh = MID$(jsonIn, jEnd, 1)
        IF jCh = "," OR jCh = "}" OR jCh = " " THEN EXIT DO
        jEnd = jEnd + 1
    LOOP

    JVal$ = MID$(jsonIn, jStart, jEnd - jStart)
END FUNCTION

FUNCTION JInt% (jsonIn AS STRING, kn AS STRING)
    JInt% = VAL(JVal$(jsonIn, kn))
END FUNCTION

FUNCTION BldResp$ (rid AS STRING, sc AS INTEGER, bj AS STRING)
    BldResp$ = "{" + _
        CHR$(34) + "_id" + CHR$(34) + ":" + CHR$(34) + JEn$(rid) + CHR$(34) + "," + _
        CHR$(34) + "statusCode" + CHR$(34) + ":" + LTRIM$(STR$(sc)) + "," + _
        CHR$(34) + "bodyJson" + CHR$(34) + ":" + CHR$(34) + JEn$(bj) + CHR$(34) + _
        "}"
END FUNCTION

' Undo JSON string escapes
FUNCTION JUn$ (txtIn AS STRING)
    DIM uOut AS STRING
    DIM uIdx AS LONG
    DIM uCh AS STRING
    DIM uCode AS LONG

    uOut = ""
    uIdx = 1
    DO WHILE uIdx <= LEN(txtIn)
        uCh = MID$(txtIn, uIdx, 1)
        IF uCh = "\" AND uIdx < LEN(txtIn) THEN
            uIdx = uIdx + 1
            uCh = MID$(txtIn, uIdx, 1)
            SELECT CASE uCh
                CASE "n": uCh = CHR$(10)
                CASE "t": uCh = CHR$(9)
                CASE "r": uCh = CHR$(13)
                CASE "b": uCh = CHR$(8)
                CASE "f": uCh = CHR$(12)
                CASE "u"
                    uCode = VAL("&H" + MID$(txtIn, uIdx + 1, 4))
                    uIdx = uIdx + 4
                    IF uCode < 128 THEN
                        uCh = CHR$(uCode)
                    ELSEIF uCode < 2048 THEN
                        uCh = CHR$(192 + (uCode \ 64)) + CHR$(128 + (uCode MOD 64))
                    ELSE
                        uCh = CHR$(224 + (uCode \ 4096)) + CHR$(128 + ((uCode \ 64) MOD 64)) + CHR$(128 + (uCode MOD 64))
                    END IF
            END SELECT
        END IF
        uOut = uOut + uCh
        uIdx = uIdx + 1
    LOOP
    JUn$ = uOut
END FUNCTION

' Escape text for use inside a JSON string
FUNCTION JEn$ (txtIn AS STRING)
    DIM eOut AS STRING
    DIM eIdx AS LONG
    DIM eCode AS INTEGER

    eOut = ""
    FOR eIdx = 1 TO LEN(txtIn)
        eCode = ASC(MID$(txtIn, eIdx, 1))
        SELECT CASE eCode
            CASE 34
                eOut = eOut + "\" + CHR$(34)
            CASE 92
                eOut = eOut + "\" + "\"
            CASE 10
                eOut = eOut + "\" + "n"
            CASE 13
                eOut = eOut + "\" + "r"
            CASE 9
                eOut = eOut + "\" + "t"
            CASE IS < 32
                eOut = eOut + "\u00" + RIGHT$("0" + HEX$(eCode), 2)
            CASE ELSE
                eOut = eOut + CHR$(eCode)
        END SELECT
    NEXT eIdx
    JEn$ = eOut
END FUNCTION

' Fixed-length string without its padding (spaces and NULs)
FUNCTION TrimF$ (txtIn AS STRING)
    DIM tEnd AS LONG
    tEnd = LEN(txtIn)
    DO WHILE tEnd > 0
        IF MID$(txtIn, tEnd, 1) <> " " AND MID$(txtIn, tEnd, 1) <> CHR$(0) THEN EXIT DO
        tEnd = tEnd - 1
    LOOP
    TrimF$ = LEFT$(txtIn, tEnd)
END FUNCTION

' Number text that is valid JSON (QB64 prints .5 and 1D+10)
FUNCTION FixNum$ (txtIn AS STRING)
    DIM nOut AS STRING
    DIM nPos AS INTEGER
    nOut = LTRIM$(txtIn)
    nPos = INSTR(nOut, "D")
    IF nPos > 0 THEN MID$(nOut, nPos, 1) = "E"
    IF LEFT$(nOut, 1) = "." THEN nOut = "0" + nOut
    IF LEFT$(nOut, 2) = "-." THEN nOut = "-0" + MID$(nOut, 2)
    FixNum$ = nOut
END FUNCTION

FUNCTION NumD$ (v AS DOUBLE)
    NumD$ = FixNum$(STR$(v))
END FUNCTION

FUNCTION NumS$ (v AS SINGLE)
    NumS$ = FixNum$(STR$(v))
END FUNCTION
