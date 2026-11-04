' runtime.bas — nextjs-basic framework STDIO loop
$CONSOLE:ONLY
' Concatenated BEFORE route.glue.bas and route.bas at compile time.
'
' QB64 keyword avoidance rules applied here:
'   - No underscore prefixes on variables
'   - No QB64 keywords as variable/sub names or substrings in names
'   - Main module code MUST come before SUB/FUNCTION definitions
'   - No user-defined TYPE variables as SUB/FUNCTION parameters
'
' The user's route.bas MUST define:
'   FUNCTION RunRoute$ (methStr AS STRING)
' which dispatches on methStr ("GET", "POST", etc.) and returns the body JSON.

' ---------------------------------------------------------------------------
' Framework envelope types
' ---------------------------------------------------------------------------

TYPE Request
    method   AS STRING * 6
    path     AS STRING * 255
    bodyJson AS STRING * 4096
    reqId    AS STRING * 36
    endpoint AS STRING * 64
END TYPE

TYPE Response
    statusCode AS INTEGER
    bodyJson   AS STRING * 4096
    reqId      AS STRING * 36
END TYPE

' ---------------------------------------------------------------------------
' Shared globals — visible to all SUBs and the main loop
' ---------------------------------------------------------------------------

DIM SHARED gReq AS Request
DIM SHARED gResp AS Response

' ---------------------------------------------------------------------------
' Forward declaration for the user-defined route dispatcher
' ---------------------------------------------------------------------------

DECLARE FUNCTION RunRoute$ (methStr AS STRING)

' ---------------------------------------------------------------------------
' Main STDIO loop
' ---------------------------------------------------------------------------

DIM reqLine AS STRING
DIM methStr AS STRING

DO
    LINE INPUT reqLine
    IF reqLine = "" THEN _CONTINUE

    gReq.reqId    = JStr$(reqLine, "_id")
    gReq.method   = JStr$(reqLine, "method")
    gReq.path     = JStr$(reqLine, "path")
    gReq.bodyJson = JStr$(reqLine, "bodyJson")
    gReq.endpoint = JStr$(reqLine, "endpoint")

    gResp.statusCode = 200
    gResp.bodyJson   = "{}"
    gResp.reqId      = gReq.reqId

    methStr = RTRIM$(gReq.method)

    IF methStr = "GET" OR methStr = "POST" OR methStr = "PUT" OR methStr = "DELETE" OR methStr = "PATCH" THEN
        gResp.bodyJson = RunRoute$(methStr)
    ELSE
        gResp.statusCode = 405
        gResp.bodyJson = "{" + CHR$(34) + "error" + CHR$(34) + ":" + CHR$(34) + "Method Not Allowed" + CHR$(34) + "}"
    END IF

    PRINT BldResp$(RTRIM$(gResp.reqId), gResp.statusCode, RTRIM$(gResp.bodyJson))
    _DELAY 0

LOOP

' ---------------------------------------------------------------------------
' JSON helper functions
' ---------------------------------------------------------------------------

FUNCTION JStr$ (jsonIn AS STRING, kn AS STRING)
    DIM srchKey AS STRING
    DIM jPos AS INTEGER
    DIM jStart AS INTEGER
    DIM jEnd AS INTEGER
    DIM jCh AS STRING * 1

    srchKey = CHR$(34) + kn + CHR$(34) + ":"
    jPos = INSTR(jsonIn, srchKey)
    IF jPos = 0 THEN JStr$ = "": EXIT FUNCTION

    jStart = jPos + LEN(srchKey)
    DO WHILE MID$(jsonIn, jStart, 1) = " " OR MID$(jsonIn, jStart, 1) = CHR$(9)
        jStart = jStart + 1
    LOOP

    IF MID$(jsonIn, jStart, 1) <> CHR$(34) THEN JStr$ = "": EXIT FUNCTION

    jStart = jStart + 1
    jEnd = jStart
    DO
        jCh = MID$(jsonIn, jEnd, 1)
        IF jCh = CHR$(34) THEN EXIT DO
        IF jCh = "" THEN EXIT DO
        IF jCh = "\" THEN jEnd = jEnd + 1
        jEnd = jEnd + 1
    LOOP

    JStr$ = JUn$(MID$(jsonIn, jStart, jEnd - jStart))
END FUNCTION

FUNCTION JInt% (jsonIn AS STRING, kn AS STRING)
    DIM srchKey AS STRING
    DIM jPos AS INTEGER
    DIM jStart AS INTEGER
    DIM numBuf AS STRING
    DIM jCh AS STRING * 1
    DIM jIdx AS INTEGER

    srchKey = CHR$(34) + kn + CHR$(34) + ":"
    jPos = INSTR(jsonIn, srchKey)
    IF jPos = 0 THEN JInt% = 0: EXIT FUNCTION

    jStart = jPos + LEN(srchKey)
    DO WHILE MID$(jsonIn, jStart, 1) = " "
        jStart = jStart + 1
    LOOP

    numBuf = ""
    jIdx = jStart
    DO
        jCh = MID$(jsonIn, jIdx, 1)
        IF (jCh >= "0" AND jCh <= "9") OR jCh = "-" THEN
            numBuf = numBuf + jCh
        ELSE
            EXIT DO
        END IF
        jIdx = jIdx + 1
    LOOP

    IF numBuf = "" OR numBuf = "-" THEN JInt% = 0: EXIT FUNCTION
    JInt% = VAL(numBuf)
END FUNCTION

FUNCTION BldResp$ (rid AS STRING, sc AS INTEGER, bj AS STRING)
    BldResp$ = "{" + _
        CHR$(34) + "_id" + CHR$(34) + ":" + CHR$(34) + rid + CHR$(34) + "," + _
        CHR$(34) + "statusCode" + CHR$(34) + ":" + LTRIM$(STR$(sc)) + "," + _
        CHR$(34) + "bodyJson" + CHR$(34) + ":" + CHR$(34) + JEn$(bj) + CHR$(34) + _
        "}"
END FUNCTION

FUNCTION JUn$ (txtIn AS STRING)
    DIM uOut AS STRING
    DIM uIdx AS INTEGER
    DIM uCh AS STRING
    uOut = ""
    uIdx = 1
    DO WHILE uIdx <= LEN(txtIn)
        uCh = MID$(txtIn, uIdx, 1)
        IF uCh = "\" AND uIdx < LEN(txtIn) THEN
            uIdx = uIdx + 1
            uCh = MID$(txtIn, uIdx, 1)
            IF uCh = "n" THEN uCh = CHR$(10)
            IF uCh = "t" THEN uCh = CHR$(9)
        END IF
        uOut = uOut + uCh
        uIdx = uIdx + 1
    LOOP
    JUn$ = uOut
END FUNCTION

FUNCTION JEn$ (txtIn AS STRING)
    DIM eOut AS STRING
    DIM eIdx AS INTEGER
    DIM eCh AS STRING
    eOut = ""
    FOR eIdx = 1 TO LEN(txtIn)
        eCh = MID$(txtIn, eIdx, 1)
        IF eCh = CHR$(34) OR eCh = "\" THEN
            eOut = eOut + "\" + eCh
        ELSEIF eCh = CHR$(10) THEN
            eOut = eOut + "\" + "n"
        ELSE
            eOut = eOut + eCh
        END IF
    NEXT eIdx
    JEn$ = eOut
END FUNCTION
