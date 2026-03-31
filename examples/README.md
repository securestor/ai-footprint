# Examples

Enterprise-grade examples demonstrating AI Footprint in real-world scenarios.

## Examples

### [`enterprise-api/`](enterprise-api/)
A mixed codebase with human-written and AI-generated code from multiple tools (ChatGPT, Copilot, Claude, Gemini). Shows how AI Footprint detects, attributes, and reports on AI code across an API project.

### [`fuzzy-matching-demo/`](fuzzy-matching-demo/)
Side-by-side comparison of an original AI snippet vs. a modified copy. Demonstrates how fuzzy matching catches code even after renaming, type changes, and parameter additions.

### [`compliance-audit/`](compliance-audit/)
Enterprise governance policy with configurable rules (AI code ratio limits, attribution requirements, registration checks). Includes an audit runner that integrates with CI.

### [`multi-repo-dashboard/`](multi-repo-dashboard/)
Generates synthetic scan history for 5 enterprise repos to showcase the dashboard with trend charts, sparklines, and multi-repo aggregation.

### [`enterprise-ci-pipeline/`](enterprise-ci-pipeline/)
Production GitHub Actions workflow with matrix scanning across microservices, a compliance gate, artifact uploads, and security team alerting.
