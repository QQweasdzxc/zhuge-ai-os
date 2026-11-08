const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('TF uses canonical UUID only at identity handoff, then native signed credentials; no caller Supabase JWT is retained',()=>{
 const bridge=fs.readFileSync('labs/taskflow/overrides/zhuge_auth.go','utf8');
 assert.match(bridge,/zhugePGUUID\(identity.ID\)/);assert.match(bridge,/verifyZhugeIdentity\(r.Context\(\), token\)/);assert.match(bridge,/tokenString, err := h.issueJWT\(user\)/);assert.match(bridge,/auth.SetAuthCookies\(w, tokenString\)/);
 assert.equal((bridge.match(/zhugeSupabaseRequest\(/g)||[]).length,2); // declaration + one /auth/v1/user call
 assert.match(bridge,/zhugeSupabaseRequest\(ctx, http.MethodGet, \"\/auth\/v1\/user\", token, nil\)/);
 const issuer=fs.readFileSync('third_party/multica/server/internal/handler/auth.go','utf8');assert.match(issuer,/jwt.NewWithClaims\(jwt.SigningMethodHS256/);assert.match(issuer,/token.SignedString\(auth.JWTSecret\(\)\)/);
 const renewal=fs.readFileSync('third_party/multica/server/internal/handler/session.go','utf8');assert.match(renewal,/auth.ParseSessionToken\(rawToken\)/);assert.doesNotMatch(renewal,/is_app_access_approved|zhugeSupabaseRequest/);
 const middleware=fs.readFileSync('third_party/multica/server/internal/middleware/auth.go','utf8');assert.match(middleware,/return auth.JWTSecret\(\), nil/);assert.doesNotMatch(middleware,/is_app_access_approved|resolve_app_access/);
 const house=fs.readFileSync('labs/taskflow/patches/apply-zhuge-house-rules.py','utf8');assert.match(house,/h.ZhugeManagedOnly/);
 const ui=fs.readFileSync('labs/taskflow/access-management/index.html','utf8');assert.match(ui,/目前不涵蓋 TF/);
});
