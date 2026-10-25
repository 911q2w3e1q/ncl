using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Newtonsoft.Json;

namespace Ncl.Core
{
    public class Account
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("name")] public string Name { get; set; }
        [JsonProperty("uuid")] public string Uuid { get; set; }
        [JsonProperty("apiRoot")] public string ApiRoot { get; set; }
        [JsonProperty("username")] public string Username { get; set; }
        [JsonProperty("accessToken")] public string AccessToken { get; set; }
        [JsonProperty("clientToken")] public string ClientToken { get; set; }
        [JsonProperty("refreshToken")] public string RefreshToken { get; set; }
        [JsonProperty("xuid")] public string Xuid { get; set; }
        [JsonProperty("expiresAt")] public long ExpiresAt { get; set; }
        [JsonProperty("skinUrl")] public string SkinUrl { get; set; }
        [JsonProperty("capeUrl")] public string CapeUrl { get; set; }
        [JsonProperty("model")] public string Model { get; set; }
        [JsonProperty("createdAt")] public long CreatedAt { get; set; }
        [JsonProperty("lastLoginAt")] public long LastLoginAt { get; set; }
        [JsonProperty("profiles")] public List<JProfile> Profiles { get; set; } = new List<JProfile>();
    }

    public class JProfile
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Name { get; set; }
    }

    public class AccountsFile
    {
        [JsonProperty("accounts")] public List<Account> Accounts { get; set; } = new List<Account>();
        [JsonProperty("selectedId")] public string SelectedId { get; set; }
    }

    public static class AccountTypes
    {
        public const string Offline = "offline";
        public const string Yggdrasil = "yggdrasil";
        public const string Microsoft = "microsoft";
    }

    public static class Accounts
    {
        private static AccountsFile _cache;

        public static AccountsFile Load()
        {
            if (_cache != null) return _cache;
            try
            {
                if (File.Exists(Paths.AccountsFile))
                {
                    _cache = JsonConvert.DeserializeObject<AccountsFile>(File.ReadAllText(Paths.AccountsFile));
                    if (_cache == null) _cache = new AccountsFile();
                    if (_cache.Accounts == null) _cache.Accounts = new List<Account>();
                }
                else _cache = new AccountsFile();
            }
            catch { _cache = new AccountsFile(); }
            return _cache;
        }

        public static void Save(AccountsFile data)
        {
            _cache = data;
            try
            {
                string dir = Path.GetDirectoryName(Paths.AccountsFile);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(Paths.AccountsFile, JsonConvert.SerializeObject(data, Formatting.Indented));
            }
            catch { }
        }

        public static void Reset() { _cache = null; }

        public static Account Selected()
        {
            var d = Load();
            if (string.IsNullOrEmpty(d.SelectedId)) return null;
            return d.Accounts.Find(a => a.Id == d.SelectedId);
        }

        /// <summary>离线登录：MD5("Offline:" + name) 生成 UUID</summary>
        public static Account OfflineLogin(string name)
        {
            name = (name ?? "").Trim();
            if (!Regex.IsMatch(name, @"^[A-Za-z0-9_]{3,16}$"))
                throw new Exception("玩家名需为 3-16 位字母、数字或下划线");
            string h = Net.Md5Hex("Offline:" + name);
            string uuid = string.Join("-", new[] {
                h.Substring(0,8), h.Substring(8,4), h.Substring(12,4), h.Substring(16,4), h.Substring(20) });
            return new Account
            {
                Id = Net.Uuid(),
                Type = AccountTypes.Offline,
                Name = name,
                Uuid = uuid,
                CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };
        }
    }
}
