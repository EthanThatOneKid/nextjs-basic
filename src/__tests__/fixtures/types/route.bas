' Test fixture: exercises every supported field type in both directions.

TYPE Request
    anInt    AS INTEGER
    aLong    AS LONG
    aDouble  AS DOUBLE
    aSingle  AS SINGLE
    aBig     AS _INTEGER64
    aByte    AS _UNSIGNED _BYTE
    note     AS STRING * 40
END TYPE

TYPE Response
    anInt    AS INTEGER
    aLong    AS LONG
    aDouble  AS DOUBLE
    aSingle  AS SINGLE
    aBig     AS _INTEGER64
    aByte    AS _UNSIGNED _BYTE
    note     AS STRING * 60
    onlyWhenSeven AS INTEGER
END TYPE

SUB CopyBack
    Resp.anInt   = Req.anInt
    Resp.aLong   = Req.aLong
    Resp.aDouble = Req.aDouble
    Resp.aSingle = Req.aSingle
    Resp.aBig    = Req.aBig
    Resp.aByte   = Req.aByte
    Resp.note    = RTRIM$(Req.note)
    ' set on some requests only, to prove Resp is cleared between requests
    IF Req.anInt = 7 THEN Resp.onlyWhenSeven = 1
END SUB

SUB OnGet
    CopyBack
END SUB

SUB OnPost
    CopyBack
END SUB

SUB OnPut
    Respond 201
    CopyBack
END SUB

SUB OnDelete
    Fail 418, "teapot says " + CHR$(34) + "no" + CHR$(34)
END SUB
