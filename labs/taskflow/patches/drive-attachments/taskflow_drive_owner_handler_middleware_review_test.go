package handler
import("net/http";"net/http/httptest";"strings";"testing";"time";"github.com/golang-jwt/jwt/v5";"github.com/multica-ai/multica/server/internal/auth";"github.com/multica-ai/multica/server/internal/middleware")
func TestTaskFlowOwnerMiddlewarePrivateReview(t *testing.T){
 owner:="fixture-owner";email:="owner@example.test";origin:="https://tf.example.test"
 token,_:=jwt.NewWithClaims(jwt.SigningMethodHS256,jwt.MapClaims{"sub":owner,"email":email,"sid":strings.Repeat("a",32),"iat":time.Now().Add(-time.Minute).Unix(),"exp":time.Now().Add(time.Hour).Unix()}).SignedString(auth.JWTSecret())
 for _,tc:=range []struct{name,token,origin string;enabled bool;status int}{{"default_off",token,origin,false,403},{"explicit_native",token,origin,true,204},{"cross_origin",token,"https://evil.example.test",true,403},{"missing_origin",token,"",true,403},{"service","sat_fixture",origin,true,401},{"task","mat_fixture",origin,true,401},{"pat","mul_fixture",origin,true,401},{"cloud","mcn_fixture",origin,true,401}}{
 t.Run(tc.name,func(t *testing.T){r:=httptest.NewRequest("POST",origin+"/api/taskflow-drive/setup",strings.NewReader("{}"));for k,v:=range map[string]string{"Authorization":"Bearer "+tc.token,"Origin":tc.origin,"Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"cors","Sec-Fetch-Dest":"empty","Content-Type":"application/json","X-TaskFlow-Drive-Setup":"1","X-User-ID":"attacker","X-User-Email":"attacker@example.test","X-Actor-Source":"member","X-Agent-ID":"forged","X-Task-ID":"forged"}{r.Header.Set(k,v)}
 w:=httptest.NewRecorder();next:=http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){if !tc.enabled||!taskflowDriveOwnerNativeSession(r,r.Header.Get("X-User-ID"),owner,email,origin){w.WriteHeader(403);return};w.WriteHeader(204)})
 middleware.Auth(nil,nil,nil,nil)(next).ServeHTTP(w,r)
 if w.Code!=tc.status{t.Fatalf("got%d want%d",w.Code,tc.status)};if len(w.Header().Values("Set-Cookie"))!=0{t.Fatal("cookie mutated")};if strings.Contains(w.Body.String(),token){t.Fatal("token leaked")}
 })}
}
