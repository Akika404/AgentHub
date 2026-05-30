# @agenthub/server

AgentHub backend service, built with **NestJS**.

# Backend Development Rules

## Core Principle: Backend API Design Comes First

The mock interfaces in the frontend code are only for **referencing business intent**; they are **not the contract** of the backend API.
When implementing backend interfaces, the following order must be strictly followed:

### 1. Design the API from the Backend's Perspective First
Before writing any backend interface, design the API independently based on the following factors:
- Database schema or domain model
- Consistency with RESTful / RPC conventions
- Unified conventions for authentication, pagination, and error handling
- Stylistic consistency with existing backend interfaces; if no existing interface is available, design/implement according to engineering best practices

### 2. Then Compare with the Frontend Mock
After designing the backend API, compare it with the frontend mock or the format the frontend actually consumes:
- **If consistent**: implement directly
- **If inconsistent**: **do not** distort the backend design to accommodate the frontend

### 3. Procedure When Frontend and Backend Designs Are Inconsistent
When a reasonable backend design conflicts with the frontend mock, you must:
1. **Explicitly list the differences** in your reply (field names, structure, semantics)
2. Explain **why the backend design is more reasonable**
3. Provide **two options**:
  - Option A: Modify the frontend to adapt to the backend (generally recommended)
  - Option B: Add an adapter layer / DTO conversion on the backend (only when the cost of changing the frontend is extremely high)
4. **Wait for the user's confirmation** before taking action; do not decide on your own
5. **It is forbidden** to write backend interfaces that violate REST / domain model principles just to "keep the frontend from breaking"

### 4. Explicitly Forbidden Behaviors
- Returning fields from the backend that match frontend expectations but have unclear semantics (e.g. `data.data.list.items`)
- Inferring that "the backend must be this way" simply because the frontend uses a certain format
- Silently modifying frontend code to match the backend (frontend code may be modified, but it must be explicitly disclosed)

## Tech Stack Constraints
- Use NestJS
- DTOs and Entities must be kept separate
- Errors must be thrown via [the unified exception class], never returned as a bare 500

## API Documentation
- Interactive API docs (Scalar UI) are served at `/api/reference`; the raw OpenAPI JSON is at `/api/openapi.json`. Toggle off via `API_DOCS_ENABLED=false`.
- Document new routes with `@ApiTags` / `@ApiOperation` and wrap responses with `@ApiEnvelope(model)` so the docs reflect the unified `{ code, message, data, timestamp }` envelope; response shapes need a DTO **class** (interfaces are erased at runtime and produce empty schemas).

## Collaboration with the Frontend
- Once a backend API is finalized, the `shared type definitions` or documentation must be updated accordingly
- Frontend mocks should be **replaced** once the backend interface is finalized, not the other way around
