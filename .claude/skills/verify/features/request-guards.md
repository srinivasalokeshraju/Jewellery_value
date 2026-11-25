# Request guards

The Worker refuses abusive requests to `/mcp` before the MCP server reads them: more than 60 requests a minute from one caller, a JSON-RPC batch of more than 10 messages, and a body over 1 MiB.

## Sub-features

- `guard-body` answers `413` with JSON-RPC error `-32000` to a body over 1 MiB, whether the request declares its length or streams it.
- `guard-batch` answers `400` with JSON-RPC error `-32600` to a batch of 11 or more messages.
- `guard-rate` answers `429` once a caller passes 60 requests in a minute.

## How to get to it (user POV)

- Any HTTP client that posts to `/mcp`. A normal host never meets these limits.

## Driving it with verify.sh

Preconditions:

- `$V doctor` passes, and this recipe runs last in the run, because `guard-rate` blocks every local caller for up to a minute.
- `eval "$($V env)"` and `H=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream')`.

- **Body limit.** Run `head -c 1100000 /dev/zero | tr '\0' a > "$RUN/scratch/big.txt"` and `curl -sS -o /dev/null -w '%{http_code}\n' "${H[@]}" --data-binary @"$RUN/scratch/big.txt" "$URL" | tee "$EVIDENCE/guard-body.txt"`. It prints `413`.
- **Body limit, streamed.** Run the same `curl` with `-H 'transfer-encoding: chunked'` added and `tee "$EVIDENCE/guard-body-chunked.txt"`. It also prints `413`. This case has no `content-length`, so it proves the streamed read.
- **Batch limit.** Run `curl -sS "${H[@]}" -d "$(node -e 'console.log(JSON.stringify(Array.from({length:11},(_,i)=>({jsonrpc:"2.0",id:i,method:"ping"}))))')" "$URL" | tee "$EVIDENCE/guard-batch.json"`. The body has `"code":-32600` and says a batch can hold at most 10 messages.
- **Rate limit.** Run `for i in $(seq 1 70); do curl -sS -o /dev/null -w '%{http_code}\n' "${H[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' "$URL"; done | sort | uniq -c | tee "$EVIDENCE/guard-rate.txt"`. Both `200` and `429` appear. The count of `200` is 60 minus the requests the run already made this minute.

## Gotchas

- Locally every caller shares the key `local`, because there is no `cf-connecting-ip` header. Earlier `call` steps count toward the 60.
- `curl --data-binary @file` sends `content-length`, so the first body case is refused from the header before the body is read. Only the chunked case reaches the streamed read.
- The rate check runs before the body and batch checks, so the body and batch cases also count toward the 60.
- Do not run this recipe against `https://mcp.meltvalue.dev`. It is for the private local run only.
