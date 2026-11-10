package handler

import (
 "mime"
 "net/http"
 "net/url"
 "strings"
 "time"
 "github.com/golang-jwt/jwt/v5"
 "github.com/multica-ai/multica/server/internal/auth"
)

// One explicitly enabled setup operation. No cookie or token mutation.
func taskflowDriveOwnerNativeSession(r *http.Request,user,owner,email,origin string) bool {
 u,e:=url.Parse(origin)
 if e!=nil||u.Scheme!="https"||u.Host==""||u.User!=nil||u.Path!=""||u.RawQuery!=""||u.Fragment!="" {return false}
 if owner==""||email==""||user!=owner||r.Method!=http.MethodPost{return false}
 if r.Header.Get("Origin")!=origin||r.Header.Get("Sec-Fetch-Site")!="same-origin"||r.Header.Get("Sec-Fetch-Mode")!="cors"||r.Header.Get("Sec-Fetch-Dest")!="empty"||r.Header.Get("X-TaskFlow-Drive-Setup")!="1" {return false}
 media,_,e:=mime.ParseMediaType(r.Header.Get("Content-Type"));if e!=nil||media!="application/json"{return false}
 if r.URL.RawQuery!=""||r.Header.Get("X-Actor-Source")!=""||r.Header.Get("X-Agent-ID")!=""||r.Header.Get("X-Task-ID")!="" {return false}
 raw:=strings.TrimPrefix(r.Header.Get("Authorization"),"Bearer ")
 if raw==""||raw==r.Header.Get("Authorization")||len(raw)>8192{return false}
 token,e:=jwt.Parse(raw,func(t *jwt.Token)(any,error){return auth.JWTSecret(),nil},jwt.WithValidMethods([]string{"HS256"}),jwt.WithExpirationRequired(),jwt.WithIssuedAt())
 if e!=nil||!token.Valid{return false};c,ok:=token.Claims.(jwt.MapClaims);if !ok{return false}
 sub,_:=c["sub"].(string);mail,_:=c["email"].(string);sid,_:=c["sid"].(string)
 // Native issueJWT has no audience/issuer claim. Reject other token shapes;
 // deployment-specific HMAC key + exact owner/email + browser origin bind use.
 for key:=range c {switch key {case "sub","email","name","sid","iat","exp": default:return false}}
 if sub!=owner||mail!=email||len(sid)!=32||c["aud"]!=nil||c["iss"]!=nil||c["agent_id"]!=nil||c["task_id"]!=nil||c["scope"]!=nil{return false}
 for _,v:=range sid{if !(v>='0'&&v<='9'||v>='a'&&v<='f'){return false}}
 iat,e:=c.GetIssuedAt();if e!=nil||iat==nil||iat.Time.After(time.Now()) {return false}
 exp,e:=c.GetExpirationTime();if e!=nil||exp==nil||!exp.Time.After(iat.Time){return false}
 return !auth.IsTemporarilyDisabledUser(sub,mail)
}
