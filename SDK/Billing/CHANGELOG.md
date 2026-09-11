# Changelog

## Unreleased

- Added a 30-second total timeout to the built-in HTTP client while preserving caller-supplied client timeout ownership.
- Changed the built-in HTTP client to return the first redirect response without following it, preserving the original 3xx wire response while leaving injected clients in control of their own policy.
- Made caller cancellation and elapsed deadlines authoritative across request editors, injected HTTP clients, bounded response reads, and final response assembly.
- Added deterministic request/response body cleanup and fixed failure handling for malformed injected HTTP client results without changing the public API.

## 1.0.0 - 2026-08-26

- Generated the initial client for the Billing OpenAPI contract and its shared Framework health and Example operations.
- Added bounded response reads, strict server URL validation, request editors, typed component models, and published-operation metadata.
