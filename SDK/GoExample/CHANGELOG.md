# Changelog

## 1.4.0 - 2026-08-24

- Added the conditional browser-session device-name update operation; an empty name clears metadata and cookie-authenticated PATCH requests require the bound CSRF header.
- Added the optional `deviceName` field to browser-session inventory responses.
- Preserved all 1.3.0 operations and request/response contracts.

## 1.3.0 - 2026-08-24

- Added conditional browser-session inventory, subject-bound single-session revocation, and revoke-all operations.
- Preserved all 1.2.0 operations and request/response contracts.

## 1.2.0 - 2026-08-24

- Added the conditional browser-session logout operation and documented opaque cookie authentication plus the bound CSRF header for unsafe session-authenticated requests.

## 1.1.0 - 2026-08-24

- Added the conditional browser OIDC authorization start and callback operations.
- Preserved all 1.0.0 operations and request/response contracts.

## 1.0.0 - 2026-08-21

- Generated the initial Go client for all OpenAPI operations.
- Added bounded response reads, strict server URL validation, request editors, typed component models, and deprecation markers.
