Feature: Login

  Scenario Outline: User login
    Given user "<username>"
    When login with "<password>"
    Then status is "<status>"

    Examples:
      | username | password | status  |
      | admin    | valid    | success |
      | admin    | invalid  | failure |
