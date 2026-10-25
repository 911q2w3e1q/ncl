using System;
using System.Linq;
using System.Numerics;
using System.Security.Cryptography;

namespace Ncl.Core
{
    /// <summary>
    /// 纯托管 ECDSA P-256（IEEE-P1363 签名格式）。
    /// 之所以不用 .NET Framework 的 ECDsaCng：Win7 的 CNG 对 ECC 支持不完整，
    /// 纯托管实现可保证在 Win7 + .NET 4.8 上必定可用。
    /// </summary>
    public static class Ecdsa
    {
        // NIST P-256 参数
        private static readonly BigInteger P = Hex("FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF");
        private static readonly BigInteger A = Hex("FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC");
        private static readonly BigInteger B = Hex("5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B");
        private static readonly BigInteger Gx = Hex("6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296");
        private static readonly BigInteger Gy = Hex("4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5");
        private static readonly BigInteger N = Hex("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

        private static BigInteger Hex(string hex)
        {
            return BigInteger.Parse("0" + hex, System.Globalization.NumberStyles.HexNumber);
        }

        private struct Point
        {
            public BigInteger X;
            public BigInteger Y;
            public bool Infinity;
        }

        private static Point Add(Point p, Point q)
        {
            if (p.Infinity) return q;
            if (q.Infinity) return p;
            if (p.X == q.X)
            {
                if ((p.Y + q.Y) % P == 0) return new Point { Infinity = true };
                return Double(p);
            }
            BigInteger lam = Mod((q.Y - p.Y) * Inv(q.X - p.X, P), P);
            BigInteger x = Mod(lam * lam - p.X - q.X, P);
            BigInteger y = Mod(lam * (p.X - x) - p.Y, P);
            return new Point { X = x, Y = y };
        }

        private static Point Double(Point p)
        {
            if (p.Infinity || p.Y == 0) return new Point { Infinity = true };
            BigInteger lam = Mod((3 * p.X * p.X + A) * Inv(2 * p.Y, P), P);
            BigInteger x = Mod(lam * lam - 2 * p.X, P);
            BigInteger y = Mod(lam * (p.X - x) - p.Y, P);
            return new Point { X = x, Y = y };
        }

        private static Point Multiply(BigInteger k, Point p)
        {
            Point result = new Point { Infinity = true };
            Point addend = p;
            BigInteger scalar = k;
            while (scalar > 0)
            {
                if (!scalar.IsEven) result = Add(result, addend);
                addend = Double(addend);
                scalar >>= 1;
            }
            return result;
        }

        private static BigInteger Mod(BigInteger v, BigInteger m)
        {
            BigInteger r = v % m;
            if (r.Sign < 0) r += m;
            return r;
        }

        /// <summary>扩展欧几里得求逆（net48 的 BigInteger.ModPow 不支持负指数）</summary>
        public static BigInteger Inv(BigInteger a, BigInteger m)
        {
            BigInteger m0 = m, x0 = 0, x1 = 1;
            a = Mod(a, m);
            while (a > 1)
            {
                BigInteger q = a / m;
                BigInteger t = m;
                m = a;
                a = t - q * a;
                t = x0;
                x0 = x1 - q * x0;
                x1 = t;
            }
            return Mod(x1, m0);
        }

        /// <summary>生成密钥对：返回私钥 d 与公钥点 (x, y)</summary>
        public static void GenerateKeyPair(out BigInteger privateKey, out BigInteger publicX, out BigInteger publicY)
        {
            using (var rng = RandomNumberGenerator.Create())
            {
                var bytes = new byte[32];
                do
                {
                    rng.GetBytes(bytes);
                    privateKey = new BigInteger(bytes);
                    privateKey = Mod(privateKey, N - 1) + 1;
                } while (privateKey <= 1 || privateKey >= N);
            }
            var q = Multiply(privateKey, new Point { X = Gx, Y = Gy });
            publicX = q.X;
            publicY = q.Y;
        }

        /// <summary>对已算好的哈希（32 字节）签名，返回 64 字节 r||s（P1363）</summary>
        public static byte[] SignP1363(BigInteger privateKey, byte[] hash)
        {
            BigInteger z = HashToInt(hash);
            using (var rng = RandomNumberGenerator.Create())
            {
                for (int attempt = 0; attempt < 64; attempt++)
                {
                    var bytes = new byte[32];
                    rng.GetBytes(bytes);
                    BigInteger k = Mod(new BigInteger(bytes), N - 1) + 1;
                    if (k <= 0 || k >= N) continue;
                    Point rp = Multiply(k, new Point { X = Gx, Y = Gy });
                    if (rp.Infinity) continue;
                    BigInteger r = Mod(rp.X, N);
                    if (r == 0) continue;
                    BigInteger s = Mod(Inv(k, N) * (z + r * privateKey), N);
                    if (s == 0) continue;
                    // 低 S 归一化（部分服务端要求）
                    if (s > N / 2) s = N - s;
                    return ToFixed(r, 32).Concat(ToFixed(s, 32)).ToArray();
                }
            }
            throw new Exception("ECDSA 签名失败");
        }

        private static BigInteger HashToInt(byte[] hash)
        {
            byte[] b = new byte[32];
            Array.Copy(hash, 0, b, 0, Math.Min(32, hash.Length));
            return Mod(new BigInteger(b), N);
        }

        public static byte[] ToFixed(BigInteger v, int len)
        {
            byte[] b = v.ToByteArray();
            if (b.Length == len) return b;
            if (b.Length > len) return b.Skip(b.Length - len).ToArray();
            byte[] r = new byte[len];
            Array.Copy(b, 0, r, len - b.Length, b.Length);
            return r;
        }

        /// <summary>JWK 用的 base64url（无填充）</summary>
        public static string Base64Url(byte[] data)
        {
            return Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }
    }
}
