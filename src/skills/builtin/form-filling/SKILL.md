---
name: form-filling
description: Fills in a web form with the details the user gives, asks for what is missing, never enters passwords or payment details, and shows what it entered before anything is sent. Use when the user asks to fill in, complete or apply through a form.
license: Apache-2.0
compatibility: Written for Browser Helper Lite. Uses its page tools, ask_user and hand_off.
metadata:
  author: browser-helper-lite
  version: "1.0"
---

1. Read the form first with view_page: every field, which are required, the choices of each list, and whether more steps follow.
2. Use only details the user gave in this conversation. List what is missing and ask once with ask_user. Never make up a value, and never guess a date of birth, an ID number or an address.
3. Never type passwords, card numbers, security codes or one-time codes, and do not upload files: hand_off for those. Leave boxes that share data (newsletters, marketing, "share with partners") unticked unless the user asked for them.
4. Fill in one field at a time and look at the page after each step: formats (dates, phone numbers with the country code), error messages, and fields that appear after a choice.
5. Before you submit, or go to a step that sends the form, show what you entered in a table and ask with ask_user whether to send it (the extension asks too before a form is sent). On a yes, press the button that sends it yourself, and report the confirmation or reference number the page shows. Do not end with the form filled in and unsent unless the user said to stop there.
