describe("login", () => {
  beforeEach(() => {
    cy.visit("/login");
  });

  it("shows the login form", () => {
    cy.get("[data-cy=email]").should("be.visible");
    cy.get("[data-cy=password]").should("be.visible");
  });

  it("logs in with valid credentials", () => {
    cy.get("[data-cy=email]").type("qa@example.com");
    cy.get("[data-cy=password]").type("correct-horse");
    cy.get("[data-cy=login-submit]").click();
    cy.url().should("include", "/dashboard");
  });

  it("shows an error for a wrong password", () => {
    cy.get("[data-cy=email]").type("qa@example.com");
    cy.get("[data-cy=password]").type("wrong");
    cy.get("[data-cy=login-submit]").click();
    cy.get("[data-cy=login-error]").should("contain", "Invalid credentials");
  });
});
