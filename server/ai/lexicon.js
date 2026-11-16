// Curated vocabulary for matching a job posting's terms against what the
// résumé actually says. This file is DATA — expect to edit it whenever a
// posting uses a spelling the matcher didn't know. ai/coverage.js is the
// logic and should stay still.
//
// A term missing from this table still matches literally; entries are an
// accelerator, not a requirement, so a gap here degrades to exact-phrase
// matching rather than breaking.

/**
 * Each entry declares one canonical spelling plus every string that means
 * the same thing. Aliases are matched as whole token sequences, never as
 * substrings, so adding one can't create a false positive elsewhere.
 */
export const ALIASES = [
  // --- languages / runtimes ---
  { canonical: "javascript", aliases: ["js", "es6", "es2015", "ecmascript", "vanilla js"] },
  { canonical: "typescript", aliases: ["ts"] },
  { canonical: "node.js", aliases: ["node", "nodejs", "node js"] },
  { canonical: "python", aliases: ["py"] },
  { canonical: "java", aliases: [] },
  { canonical: "c#", aliases: ["csharp", "c sharp"] },
  { canonical: "c++", aliases: ["cplusplus", "cpp"] },
  { canonical: ".net", aliases: ["dotnet", "dot net", "net core", ".net core"] },

  // --- frontend ---
  { canonical: "react", aliases: ["reactjs", "react js"] },
  { canonical: "vue", aliases: ["vuejs", "vue js", "vue 3"] },
  { canonical: "nuxt", aliases: ["nuxtjs", "nuxt js", "nuxt 3"] },
  { canonical: "next.js", aliases: ["next", "nextjs", "next js"] },
  { canonical: "angular", aliases: ["angularjs", "angular 2+"] },
  { canonical: "tailwind", aliases: ["tailwindcss", "tailwind css"] },
  { canonical: "scss", aliases: ["sass"] },
  { canonical: "css", aliases: ["css3"] },
  { canonical: "html", aliases: ["html5"] },
  { canonical: "tanstack query", aliases: ["react query", "react-query"] },

  // --- backend / api ---
  { canonical: "express", aliases: ["expressjs", "express js"] },
  { canonical: "nestjs", aliases: ["nest", "nest js"] },
  { canonical: "spring boot", aliases: ["springboot", "spring-boot"] },
  { canonical: "rest", aliases: ["restful", "rest api", "rest apis", "restful api", "restful apis", "rest services"] },
  { canonical: "graphql", aliases: ["gql"] },
  { canonical: "grpc", aliases: ["g rpc"] },
  { canonical: "microservices", aliases: ["microservice", "micro services", "micro service"] },
  { canonical: "websockets", aliases: ["websocket", "web socket", "web sockets"] },

  // --- data ---
  { canonical: "postgresql", aliases: ["postgres", "psql", "postgre sql"] },
  { canonical: "mysql", aliases: ["my sql"] },
  { canonical: "mongodb", aliases: ["mongo"] },
  { canonical: "sql server", aliases: ["mssql", "ms sql", "microsoft sql server", "t sql", "tsql"] },
  { canonical: "redis", aliases: [] },
  { canonical: "elasticsearch", aliases: ["elastic search", "elastic"] },

  // --- infra / delivery ---
  { canonical: "kubernetes", aliases: ["k8s"] },
  { canonical: "docker", aliases: [] },
  { canonical: "ci/cd", aliases: ["cicd", "ci cd", "continuous integration", "continuous delivery", "continuous deployment", "ci-cd"] },
  { canonical: "github actions", aliases: ["gha"] },
  { canonical: "azure devops", aliases: ["vsts", "azure pipelines"] },
  { canonical: "azure", aliases: ["microsoft azure"] },
  { canonical: "aws", aliases: ["amazon web services"] },
  { canonical: "gcp", aliases: ["google cloud platform", "google cloud"] },
  { canonical: "openshift", aliases: ["red hat openshift", "redhat openshift"] },
  { canonical: "terraform", aliases: [] },
  { canonical: "jenkins", aliases: [] },

  // --- queues / jobs ---
  { canonical: "rabbitmq", aliases: ["rabbit mq"] },
  { canonical: "kafka", aliases: ["apache kafka"] },
  { canonical: "bullmq", aliases: ["bull mq", "bull"] },

  // --- security ---
  { canonical: "oauth2", aliases: ["oauth", "oauth 2", "oauth 2.0", "oauth20"] },
  { canonical: "oidc", aliases: ["openid connect", "open id connect"] },
  { canonical: "jwt", aliases: ["json web token", "json web tokens"] },
  { canonical: "rbac", aliases: ["role based access control", "role-based access control"] },
  { canonical: "sso", aliases: ["single sign on", "single sign-on"] },

  // --- ai ---
  { canonical: "llm", aliases: ["large language model", "large language models", "llms"] },
  { canonical: "rag", aliases: ["retrieval augmented generation", "retrieval-augmented generation"] },
  { canonical: "openai", aliases: ["open ai", "openai api", "gpt"] },
  { canonical: "gemini", aliases: ["google gemini", "gemini api"] },
  { canonical: "vector embeddings", aliases: ["embeddings", "vector embedding"] },
  { canonical: "semantic search", aliases: ["vector search"] },
  { canonical: "model context protocol", aliases: ["mcp"] },

  // --- practice ---
  { canonical: "agile", aliases: ["scrum", "kanban"] },
  { canonical: "tdd", aliases: ["test driven development", "test-driven development"] },
  { canonical: "code review", aliases: ["code reviews", "peer review", "peer reviews"] },
  { canonical: "unit testing", aliases: ["unit tests", "unit test"] },
  { canonical: "observability", aliases: ["monitoring", "structured logging"] },
];

/**
 * One-directional evidence: holding the key genuinely demonstrates the
 * values. Kept deliberately small — every entry is a claim that has to
 * survive an interview question, so "knows PostgreSQL therefore knows SQL"
 * is in, and anything vaguer stays out.
 */
export const IMPLIES = {
  postgresql: ["sql", "relational database", "relational databases", "rdbms"],
  mysql: ["sql", "relational database", "relational databases", "rdbms"],
  "sql server": ["sql", "relational database", "relational databases", "rdbms", "stored procedures"],
  mongodb: ["nosql"],
  redis: ["caching", "in memory cache"],
  kubernetes: ["container orchestration"],
  docker: ["containers", "containerization"],
  nuxt: ["vue"],
  "next.js": ["react"],
  nestjs: ["node.js"],
  express: ["node.js"],
  "spring boot": ["spring"],
  grpc: ["rpc"],
};

/**
 * Terms short or common enough that finding them inside prose means
 * nothing ("go live" must not satisfy a "Go" requirement). These match
 * ONLY when a skills or stack cell is exactly the term.
 */
export const AMBIGUOUS = new Set(["go", "r", "c", "ai", "ml", "bi", "qa", "ux", "ui"]);

/**
 * How the profile packs several skills into one table cell
 * ("Vue / Nuxt", "Node.js (Express)"). Applied to the résumé/profile side
 * only — never to a JD keyword, so "CI/CD" survives intact.
 */
export const CELL_SPLIT_RE = /\s*(?:\/|,|\||;|\band\b)\s*/;

/** Multi-character symbol runs that tokenizing would otherwise destroy. */
export const SYMBOL_FOLDS = [
  ["c++", " cplusplus "],
  ["c#", " csharp "],
  [".net", " dotnet "],
  ["ci/cd", " cicd "],
  ["ci-cd", " cicd "],
  ["tcp/ip", " tcpip "],
  ["and/or", " or "],
];
