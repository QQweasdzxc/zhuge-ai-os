package handler
import("net/http";"net/http/httptest";"strings";"testing";"time";"github.com/golang-jwt/jwt/v5";"github.com/multica-ai/multica/server/internal/auth";"github.com/multica-ai/multica/server/internal/middleware")
func TestTaskFlowOwnerAssembledPrivateReview(t *testing.T){
 owner:="fixture-owner";email:="owner@example.test";origin:="https://tf.example.test"
 t.Setenv("TASKFLOW_DRIVE_SETUP_OWNER_USER_ID",owner);t.Setenv("TASKFLOW_DRIVE_OWNER_EMAIL",email);t.Setenv("TASKFLOW_DRIVE_SETUP_WEB_ORIGIN",origin);t.Setenv("TASKFLOW_DRIVE_SETUP_ENABLED","")
 token,_:=jwt.NewWithClaims(jwt.SigningMethodHS256,jwt.MapClaims{"sub":owner,"email":email,"sid":strings.Repeat("a",32),"iat":time.Now().Add(-time.Minute).Unix(),"exp":time.Now().Add(time.Hour).Unix()}).SignedString(auth.JWTSecret())
 for _,tc:=range []struct{name,flag,origin string;status int}{{"default_off","",origin,403},{"explicit_on","1",origin,503},{"invalid_flag","true",origin,403},{"cross_origin","1","https://evil.example.test",403},{"absent_origin","1","",403}}{t.Run(tc.name,func(t *testing.T){t.Setenv("TASKFLOW_DRIVE_OWNER_NATIVE_SETUP",tc.flag);r:=httptest.NewRequest("POST",origin+"/api/taskflow-drive/setup",strings.NewReader("{}"));for k,v:=range map[string]string{"Authorization":"Bearer "+token,"Origin":tc.origin,"Sec-Fetch-Site":"same-origin","Sec-Fetch-Mode":"cors","Sec-Fetch-Dest":"empty","Content-Type":"application/json","X-TaskFlow-Drive-Setup":"1","X-User-ID":"forged","X-Actor-Source":"member"}{r.Header.Set(k,v)}
 w:=httptest.NewRecorder();h:=&Handler{};middleware.Auth(nil,nil,nil,nil)(RequireHumanActor(http.HandlerFunc(h.StartTaskFlowDriveSetup))).ServeHTTP(w,r);if w.Code!=tc.status{t.Fatalf("got%d want%d",w.Code,tc.status)};if len(w.Header().Values("Set-Cookie"))!=0{t.Fatal("cookie mutation")};if strings.Contains(w.Body.String(),token){t.Fatal("token response")}
 })}
}
