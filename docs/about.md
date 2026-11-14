# Project context

This project is a test assignment to build a wrapper around the Keitaro API for creating and editing advertising campaigns.

Keitaro is an ad tracker used to monitor advertising profitability. It directs incoming traffic according to configured rules and provides statistics about those redirects. This application will make a focused set of campaign management operations available through its own interface.

## Campaign creator

The creator accepts a campaign name, one or more country geo-codes, and a Keitaro offer ID. It creates a campaign with two streams:

- The first stream captures traffic from any of the specified countries and redirects it to Google.
- The second stream redirects traffic to the selected offer.

Domain, group, and traffic source are optional. Users can leave each unset or select an existing resource available through the Keitaro API.

## Campaign editor

The editor allows users to add and remove offers within an existing campaign. Its behavior should reproduce the logic of the existing editor demonstrated in the assignment's reference video. The interface design is flexible, but its controls must work correctly and its displayed figures must remain accurate.

The reference video has not yet been provided in this repository; detailed editor behavior will be clarified later.

## Technology requirements

The project must use FastAPI and SQLAlchemy. The frontend technology is open to choice.

## Current scope

This document records the general project context and assignment requirements. Architecture, API interactions, data models, interface design, and other implementation details will be decided in later steps.
