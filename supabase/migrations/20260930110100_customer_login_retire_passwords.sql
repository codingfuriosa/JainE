-- The customer logins created before the email code (20260930110000) all have a password staff
-- chose and know. Everyone signs in the same way now, so those passwords are replaced with a random
-- one nobody holds. The accounts, and their link to the customer, stay as they are: the next sign-in
-- is simply by code. Applied only once the email-code sign-in (customer-invite) was live, so nobody was locked out in between.
update auth.users u
   set encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')),
       updated_at = now()
  from cust.customers c
 where c.auth_user_id = u.id;
