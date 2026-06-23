# Smart Locker Identity & Custody Model

## Purpose

This document captures a public-safe smart-locker, kiosk, dock, and custody workflow pattern that complements the Credential Reader Signal Model. It is fixture-backed and deterministic only.

## Boundary

LocknCharge/FUYL-shaped systems are useful candidate patterns for identity, kiosk, smart-locker, device custody, and bay assignment workflows. This repository does not add live integrations, credentials, API calls, production device release actions, partnership claims, certification claims, endorsement claims, or customer-specific locker data.

Existing locker, dock, IAM, PACS, MDM/UEM, kiosk, and workflow tools remain systems of record. SignalGrid can normalize their public-safe event shapes, evaluate context, route approved decisions, audit evidence, and verify expected outcomes.

## Candidate event patterns

- User presents a credential at a kiosk or locker.
- Credential event is correlated to an identity source of record.
- Locker bay, dock, or custody zone is checked against expected workflow assignment.
- Shared device posture and session state are correlated before checkout or release.
- Exceptions route to identity, custody, workflow, operations, or integration owners.
- High-risk custody override remains approval-required and simulated-first.

## Safe decision boundaries

- Expected identity + expected bay + compliant shared device may become an `allowCandidate`, not an autonomous production release claim.
- Unresolved identity, wrong bay, stale event, degraded API health, or assignment mismatch cannot produce plain allow.
- Override and release exceptions require explicit approval and simulated-first evidence in this public Review Hub.
