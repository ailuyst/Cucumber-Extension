Feature: Playwright documentation search
  Scenario: Search from the documentation site
    Given I open the Playwright documentation site
    When I search for "cucumber"
    Then I should see search suggestions
