-- Logline scala się z premise: to samo zadanie (zwięzła obietnica historii),
-- a w promptach downstream pracowała tylko premise.
UPDATE books
SET premise = CASE
        WHEN TRIM(premise) = '' THEN logline
        ELSE premise || char(10) || char(10) || logline
    END
WHERE TRIM(logline) <> ''
  AND instr(premise, logline) = 0;

ALTER TABLE books DROP COLUMN logline;
