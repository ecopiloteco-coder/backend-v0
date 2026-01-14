Place your Excel templates here.

Usage with POST /upload/export-excel:

Request body example:

```
{
  "templateName": "my-template1.xlsx",
  "values": {
    "Sheet1": {
      "B2": "John Doe",
      "C3": 123.45
    },
    "Summary": {
      "A1": "Report Title"
    }
  }
}
```

Notes:
- templateName must match a file in this folder.
- values is a map of sheet names to cell-address-to-value mappings.

