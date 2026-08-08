const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    code: { type: "string", description: "Machine-readable error code when available." },
    error: { type: "string" },
  },
} as const;

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const adminAuthenticationError = {
  description: "Administrator HTTP Basic authentication is required.",
  content: {
    "text/plain": {
      schema: { type: "string" },
      example: "Authentication required",
    },
  },
} as const;

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Fashion Canvas API",
    version: "1.0.0",
    description:
      "Register and approve users, transform outfit photos, and inspect administrative service data. Uploaded and generated images are returned as data URLs and are not persisted by the server.",
  },
  servers: [{ url: "/", description: "Current server" }],
  tags: [
    { name: "Service", description: "Service health." },
    { name: "Authentication", description: "Registration, login, and account approval." },
    { name: "Outfits", description: "Authenticated outfit transformation." },
    { name: "Administration", description: "HTTP Basic-protected administration." },
    { name: "Diagnostics", description: "HTTP Basic-protected operational diagnostics." },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Service"],
        operationId: "getHealth",
        summary: "Check service health",
        responses: {
          "200": {
            description: "The service is ready.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: { status: { type: "string", enum: ["ok"] } },
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/register": {
      post: {
        tags: ["Authentication"],
        operationId: "registerUser",
        summary: "Register a pending user account",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/RegisterRequest" } },
          },
        },
        responses: {
          "201": {
            description: "Registration completed; the account is pending approval.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegistrationResponse" },
              },
            },
          },
          "400": errorResponse("The username or password is invalid."),
          "409": errorResponse("The username is already registered."),
        },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Authentication"],
        operationId: "loginUser",
        summary: "Create a user session",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } },
          },
        },
        responses: {
          "200": {
            description: "Login succeeded.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/LoginResponse" } },
            },
          },
          "401": errorResponse("The supplied credentials are invalid."),
        },
      },
    },
    "/api/auth/vouchers/redeem": {
      post: {
        tags: ["Authentication"],
        operationId: "redeemApprovalVoucher",
        summary: "Approve the current account with a voucher",
        description:
          "Atomically consumes a valid single-use voucher and approves the authenticated pending user.",
        security: [{ userBearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/VoucherRedemptionRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "The voucher was consumed and the account approved.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApprovalResponse" } },
            },
          },
          "400": errorResponse("The voucher is malformed or unknown."),
          "401": errorResponse("A valid user bearer token is required."),
          "409": errorResponse("The voucher was used or the account is already approved."),
        },
      },
    },
    "/api/outfits": {
      post: {
        tags: ["Outfits"],
        operationId: "createOutfitCanvas",
        summary: "Transform an outfit photo",
        description:
          "Requires an approved user. The source photo is processed in memory and is not persisted.",
        security: [{ userBearer: [] }],
        parameters: [
          {
            in: "header",
            name: "X-App-Version",
            required: false,
            schema: { type: "string", maxLength: 100 },
            description: "Client application version recorded with upload metadata.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["photo"],
                properties: {
                  photo: {
                    type: "string",
                    format: "binary",
                    description: "JPEG, PNG, WebP, HEIC, or HEIF image up to 12 MB.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The generated outfit canvas and individual pieces.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/OutfitResult" } },
            },
          },
          "400": errorResponse("The upload is missing, unsupported, or too large."),
          "401": errorResponse("A valid user bearer token is required."),
          "403": errorResponse("The authenticated account is awaiting approval."),
          "429": {
            ...errorResponse("The upload rate limit has been reached."),
            headers: {
              "Retry-After": {
                description: "Seconds until another upload can be attempted.",
                schema: { type: "integer" },
              },
              "RateLimit-Limit": {
                description: "Maximum uploads in the rolling window.",
                schema: { type: "integer" },
              },
              "RateLimit-Remaining": {
                description: "Uploads remaining in the current window.",
                schema: { type: "integer" },
              },
              "RateLimit-Reset": {
                description: "Unix timestamp when the window resets.",
                schema: { type: "integer" },
              },
            },
          },
          "502": errorResponse("The upstream outfit transformation failed."),
        },
      },
    },
    "/api/admin/uploads": {
      get: {
        tags: ["Administration"],
        operationId: "listUploads",
        summary: "List persistent upload metadata",
        security: [{ adminBasic: [] }],
        parameters: [
          {
            in: "query",
            name: "limit",
            schema: { type: "integer", default: 100, minimum: 1, maximum: 500 },
          },
        ],
        responses: {
          "200": {
            description: "Newest uploads first. Image contents are never included.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["uploads"],
                  properties: {
                    uploads: {
                      type: "array",
                      items: { $ref: "#/components/schemas/UploadHistoryEntry" },
                    },
                  },
                },
              },
            },
          },
          "401": adminAuthenticationError,
        },
      },
    },
    "/api/admin/users": {
      get: {
        tags: ["Administration"],
        operationId: "listUsers",
        summary: "List registered users",
        security: [{ adminBasic: [] }],
        responses: {
          "200": {
            description: "Registered users without credentials or session tokens.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["users"],
                  properties: {
                    users: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AdminUser" },
                    },
                  },
                },
              },
            },
          },
          "401": adminAuthenticationError,
        },
      },
    },
    "/api/admin/users/{id}/approve": {
      post: {
        tags: ["Administration"],
        operationId: "approveUser",
        summary: "Approve a user account",
        security: [{ adminBasic: [] }],
        parameters: [{ $ref: "#/components/parameters/UserId" }],
        responses: {
          "200": {
            description: "The account is approved.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ApprovalResponse" } },
            },
          },
          "401": adminAuthenticationError,
          "404": errorResponse("The user was not found."),
        },
      },
    },
    "/api/admin/users/{id}/revoke": {
      post: {
        tags: ["Administration"],
        operationId: "revokeUserApproval",
        summary: "Revoke a user account approval",
        security: [{ adminBasic: [] }],
        parameters: [{ $ref: "#/components/parameters/UserId" }],
        responses: {
          "200": {
            description: "The account approval is revoked.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["approved"],
                  properties: { approved: { type: "boolean", enum: [false] } },
                },
              },
            },
          },
          "401": adminAuthenticationError,
          "404": errorResponse("The user was not found."),
        },
      },
    },
    "/api/admin/vouchers": {
      get: {
        tags: ["Administration"],
        operationId: "listApprovalVouchers",
        summary: "List approval voucher history",
        description: "Returns neither hashes nor voucher codes. Only a short prefix is displayed.",
        security: [{ adminBasic: [] }],
        responses: {
          "200": {
            description: "Voucher history, newest first.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["vouchers"],
                  properties: {
                    vouchers: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AdminVoucher" },
                    },
                  },
                },
              },
            },
          },
          "401": adminAuthenticationError,
        },
      },
      post: {
        tags: ["Administration"],
        operationId: "generateApprovalVoucher",
        summary: "Generate a single-use approval voucher",
        description:
          "The complete voucher code is returned once and is not persisted in plaintext.",
        security: [{ adminBasic: [] }],
        responses: {
          "201": {
            description: "The voucher was generated.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GeneratedVoucherResponse" },
              },
            },
          },
          "401": adminAuthenticationError,
        },
      },
    },
    "/api/debug/config": {
      get: {
        tags: ["Diagnostics"],
        operationId: "getDebugConfiguration",
        summary: "Get effective service configuration",
        security: [{ adminBasic: [] }],
        responses: {
          "200": {
            description: "Non-secret runtime configuration.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DebugConfiguration" },
              },
            },
          },
          "401": adminAuthenticationError,
        },
      },
    },
    "/api/debug/rate-limits": {
      get: {
        tags: ["Diagnostics"],
        operationId: "listRateLimits",
        summary: "List active upload rate limits",
        security: [{ adminBasic: [] }],
        responses: {
          "200": {
            description: "Current rolling-window counters by client IP.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RateLimitsResponse" },
              },
            },
          },
          "401": adminAuthenticationError,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      userBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "opaque session token",
        description: "Token returned by POST /api/auth/login.",
      },
      adminBasic: {
        type: "http",
        scheme: "basic",
        description: "Administrator credentials mounted into the server as secrets.",
      },
    },
    parameters: {
      UserId: {
        in: "path",
        name: "id",
        required: true,
        schema: { type: "integer", minimum: 1 },
        description: "Numeric user ID.",
      },
    },
    schemas: {
      Error: errorSchema,
      RegisterRequest: {
        type: "object",
        required: ["username", "password"],
        additionalProperties: false,
        properties: {
          username: {
            type: "string",
            pattern: "^[a-zA-Z0-9_-]{3,32}$",
            example: "canvas_user",
          },
          password: { type: "string", format: "password", minLength: 8, maxLength: 128 },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["username", "password"],
        additionalProperties: false,
        properties: {
          username: { type: "string", example: "canvas_user" },
          password: { type: "string", format: "password" },
        },
      },
      UserSummary: {
        type: "object",
        required: ["username", "approved"],
        properties: {
          username: { type: "string" },
          approved: { type: "boolean" },
        },
      },
      RegistrationResponse: {
        type: "object",
        required: ["username", "approved", "message"],
        properties: {
          username: { type: "string" },
          approved: { type: "boolean", enum: [false] },
          message: { type: "string" },
        },
      },
      LoginResponse: {
        type: "object",
        required: ["token", "expiresAt", "user"],
        properties: {
          token: { type: "string", description: "Opaque bearer token." },
          expiresAt: { type: "string", format: "date-time" },
          user: { $ref: "#/components/schemas/UserSummary" },
        },
      },
      VoucherRedemptionRequest: {
        type: "object",
        required: ["voucher"],
        additionalProperties: false,
        properties: {
          voucher: {
            type: "string",
            pattern: "^FC-(?:[A-Fa-f0-9]{8}-){3}[A-Fa-f0-9]{8}$",
            example: "FC-A1B2C3D4-E5F60718-192A3B4C-5D6E7F80",
          },
        },
      },
      ApprovalResponse: {
        type: "object",
        required: ["approved"],
        properties: {
          approved: { type: "boolean", enum: [true] },
          message: { type: "string" },
        },
      },
      OutfitPiece: {
        type: "object",
        required: ["id", "label", "description", "category", "image"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          image: { type: "string", description: "Generated image data URL." },
        },
      },
      OutfitResult: {
        type: "object",
        required: ["styledOutfit", "pieces"],
        properties: {
          styledOutfit: { type: "string", description: "Generated outfit canvas data URL." },
          pieces: {
            type: "array",
            items: { $ref: "#/components/schemas/OutfitPiece" },
          },
          debug: {
            type: "object",
            description: "Models, normalized input, timing, token usage, and estimated cost.",
            additionalProperties: true,
          },
        },
      },
      UploadHistoryEntry: {
        type: "object",
        required: [
          "requestId",
          "ip",
          "username",
          "timestamp",
          "appVersion",
          "status",
          "fileSizeBytes",
          "tokens",
          "price",
        ],
        properties: {
          requestId: { type: "string", format: "uuid" },
          ip: { type: "string" },
          username: { type: "string", nullable: true },
          timestamp: { type: "string", format: "date-time" },
          appVersion: { type: "string" },
          status: { type: "string", enum: ["processing", "completed", "failed"] },
          fileSizeBytes: { type: "integer", nullable: true },
          tokens: {
            type: "object",
            required: [
              "analysisInput",
              "analysisOutput",
              "generationInput",
              "generationOutput",
              "total",
            ],
            properties: {
              analysisInput: { type: "integer", nullable: true },
              analysisOutput: { type: "integer", nullable: true },
              generationInput: { type: "integer", nullable: true },
              generationOutput: { type: "integer", nullable: true },
              total: { type: "integer", nullable: true },
            },
          },
          price: {
            type: "object",
            required: ["usd", "kind"],
            properties: {
              usd: { type: "number", format: "double", nullable: true },
              kind: { type: "string", enum: ["estimated", "calculated"] },
            },
          },
        },
      },
      AdminUser: {
        allOf: [
          { $ref: "#/components/schemas/UserSummary" },
          {
            type: "object",
            required: ["id", "createdAt", "approvedAt"],
            properties: {
              id: { type: "integer" },
              createdAt: { type: "string", format: "date-time" },
              approvedAt: { type: "string", format: "date-time", nullable: true },
            },
          },
        ],
      },
      AdminVoucher: {
        type: "object",
        required: ["id", "prefix", "createdAt", "usedAt", "usedByUsername"],
        properties: {
          id: { type: "integer" },
          prefix: { type: "string", example: "FC-A1B2C3D4" },
          createdAt: { type: "string", format: "date-time" },
          usedAt: { type: "string", format: "date-time", nullable: true },
          usedByUsername: { type: "string", nullable: true },
        },
      },
      GeneratedVoucherResponse: {
        type: "object",
        required: ["voucher"],
        properties: {
          voucher: {
            allOf: [
              { $ref: "#/components/schemas/AdminVoucher" },
              {
                type: "object",
                required: ["code"],
                properties: {
                  code: {
                    type: "string",
                    description: "Complete voucher code, returned only at generation time.",
                  },
                },
              },
            ],
          },
        },
      },
      DebugConfiguration: {
        type: "object",
        required: [
          "visionModel",
          "imageModel",
          "inputMaxDimension",
          "fullOutfitSize",
          "pieceSize",
          "outputQuality",
          "maxUploadBytes",
          "rateLimit",
        ],
        properties: {
          visionModel: { type: "string" },
          imageModel: { type: "string" },
          inputMaxDimension: { type: "integer" },
          fullOutfitSize: { type: "string" },
          pieceSize: { type: "string" },
          outputQuality: { type: "string" },
          maxUploadBytes: { type: "integer" },
          rateLimit: {
            type: "object",
            required: ["uploads", "windowSeconds"],
            properties: {
              uploads: { type: "integer" },
              windowSeconds: { type: "integer" },
            },
          },
        },
      },
      RateLimitClient: {
        type: "object",
        required: ["ip", "username", "count", "remaining", "resetAt", "totalUploads", "lastSeenAt"],
        properties: {
          ip: { type: "string" },
          username: { type: "string", nullable: true },
          count: { type: "integer" },
          remaining: { type: "integer" },
          resetAt: { type: "string", format: "date-time" },
          totalUploads: { type: "integer" },
          lastSeenAt: { type: "string", format: "date-time" },
        },
      },
      RateLimitsResponse: {
        type: "object",
        required: ["limit", "windowSeconds", "clients"],
        properties: {
          limit: { type: "integer" },
          windowSeconds: { type: "integer" },
          clients: {
            type: "array",
            items: { $ref: "#/components/schemas/RateLimitClient" },
          },
        },
      },
    },
  },
} as const;
