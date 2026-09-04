/* ==========================================================================
   config.js — the only file WK needs to edit to change how the login and
   the embed check behave. Nothing else in the simulation needs touching.
   ========================================================================== */

var CONFIG = {

  /* ----------------------------------------------------------------------
     requireLogin
     true  = visitors must type a username and password before the game.
     false = the login screen disappears completely and the game starts.
     ---------------------------------------------------------------------- */
  requireLogin: true,

  /* ----------------------------------------------------------------------
     username
     The name visitors type. This is the one currently in use.
     ---------------------------------------------------------------------- */
  username: "CaseMentor9187",

  /* ----------------------------------------------------------------------
     passcodeHash
     The password, scrambled. The real password is never written down here,
     which is why this looks like nonsense.

     >>> THIS IS A TEMPORARY PASSWORD AND MUST BE CHANGED BEFORE LAUNCH. <<<

     The password below is currently:   change-me-before-launch

     It is written here on purpose so you can open the simulation and check
     it works. Because anyone can read this repository, it protects nothing.
     To set a real one:

       1. Open  tools/make-passcode.html  in your browser.
       2. Type the password you want.
       3. Copy the long line of letters and numbers it prints.
       4. Paste it below, replacing everything between the quote marks.
       5. Upload this file to GitHub.

     Do not reuse the password from the old simulation. It has been readable
     in a public repository since the site was built.
     ---------------------------------------------------------------------- */
  passcodeHash: "22d1c9017df0929ef31cfd943bbc97d2adeff40c010e19d89f1a006943f2132c",

  /* ----------------------------------------------------------------------
     blockDirectAccess
     false = anybody who has the web address can open the simulation.
     true  = the simulation only opens when it is inside a course lesson on
             one of the addresses listed below.

     LEAVE THIS false until you have run tools/embed-test.html inside a
     hidden lesson and confirmed which address the lesson actually runs
     under. Switching it on before then risks locking out paying customers.

     Even when it is true, the check lets people through whenever it cannot
     tell where the page is being shown from. That is deliberate: being too
     strict would lock out a customer on a Sunday with nobody to fix it.
     ---------------------------------------------------------------------- */
  blockDirectAccess: false,

  /* ----------------------------------------------------------------------
     allowedEmbedDomains
     The addresses a course lesson may be served from. Only used when
     blockDirectAccess is true.
     ---------------------------------------------------------------------- */
  allowedEmbedDomains: [
    "app.casementor.com",
    "casementor.spayee.com"
  ]

};
