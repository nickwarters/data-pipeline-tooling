# Case Review Frontend Framework

This project is a Vanilla JavaScript, HTML and CSS framework for building the frontend
layer of a Case Review Platform

## Why is this being created

It is designed to be a framework to compose frontend pages to be hosted on on-prem SharePoint infra.
JavasScript is to be added to SharePoint Style Library, linked in code blocks into small HTML files, and then the HTML
files are injected into Content Editor sections in SharePoint pages.

SharePoint pages are restrictive and clunky. This framework removes all sharepoint "branding" and makes
the page look like a normal web page.

## Main Components

### Dashboard page

This is the landing page for all users. Depending on the user group, different
sections on the page are loaded to take different actions and see different information

Sections should not be loaded if the user does not have permission via the relevant SharePoint User Group.

#### View Outstanding Cases

Reviewers should be able to see their assigned outstanding cases. The cases are stored on SharePoint lists in the same SharePoint.
Case Type Owners should be able to see the amount of cases of their particualr type they own that are outstanding, assigned, overdue, and completed today and in the last 7 days. Just high level numbers.

#### Case Allocation

Reviewers should be able to request the next available case to be assigned to them. Depending on what the user is able to review (based on different case types and properties) the next available case should be assigned to them and be visible in the outstanding cases list. Different case types are stored in different lists.

### Case Review Page

This is the main page used by reviewers to review the cases. Cases have a few section, all should be configurable.

#### Case Details

This is where the user will see the main details about the case: the type, when it took place, who was responsible, the customer, any related products, among other things.

#### The Questions

This section contains between 1 and 500 questions per individual case. Each question response could be "Yes/No", "Yes/No/Not Applicable", a single or multiple choice with specific options for the question, and each question could depend on responses of other questions. For example, Question 1 with the answer "Yes" could trigger Question 17, and when that is answered with "No" could trigger Question 76. All questions should have a unique identifier to enable easy tracking of trends and identify problem areas.

This section needs to be able to scale well from 1 to 500 questions on a given case.
The UX needs to be VERY good here. Users should be easily able to answer all the questions without feeling overwhelmed.

#### The Conversation

This section allows the reviewer and the person responsbile for the case to communicate if the reviewer needs to clarify any information. Messages should just be stored in SharePoint lists, 1 item per case. Messages can be added to JSON arrays and stored in plain text on the list.

#### Remediation

Where remediation has been identified (attached to each failed question), there should be a summary of the remediation required showing the question category, the question wording, the response and the actions required (there can be multiple actions added to a question).

#### Case Outcome

Where the overall outcome for the case is generate. Outcome is determine by an algorithm for the case type, based on the question answers. Additionally this is where any other case information relevant to the review is added (notes, justification, etc)

#### Notes

This is where any other case information relevant to the review is added (notes, justification, etc)
