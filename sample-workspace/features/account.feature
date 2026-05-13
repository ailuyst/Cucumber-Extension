@account
Feature: Account setup through custom hooks
  Scenario Outline: Account is prepared for a user role
    Given a test account exists
    When I assign the account role "<role>"
    Then the account should have role "<role>"
    And the account email should contain "<emailDomain>"

    Examples:
      | role     | emailDomain  |
      | customer | example.test |
      | admin    | example.test |
      | manager  | example.test |
