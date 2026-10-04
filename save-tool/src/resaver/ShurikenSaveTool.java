/*
 * Shuriken save tool: a small command-line front end for the ReSaver save engine
 * from FallrimTools by Mark Fairchild (Apache License 2.0).
 *
 *   info  <save>                     prints a JSON report
 *   clean <save> <out> [ops...]      writes a cleaned copy to <out> and prints a JSON report
 *        ops: unattached undefined nonexistent formlists havok
 *
 * Licensed under the Apache License, Version 2.0.
 */
package resaver;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.logging.Level;
import java.util.logging.Logger;
import resaver.ess.ESS;
import resaver.ess.ModelBuilder;
import resaver.ess.Plugin;
import resaver.ess.papyrus.Papyrus;
import resaver.ess.papyrus.ScriptInstance;

public class ShurikenSaveTool {

    public static void main(String[] args) {
        Logger.getLogger("").setLevel(Level.SEVERE);
        try {
            if (args.length < 2) throw new IllegalArgumentException("usage: info <save> | clean <save> <out> [ops...]");
            if (args[0].equals("info")) {
                ESS ess = read(Paths.get(args[1]));
                System.out.println(report(ess, null));
            } else if (args[0].equals("clean")) {
                if (args.length < 3) throw new IllegalArgumentException("clean needs <save> <out>");
                ESS ess = read(Paths.get(args[1]));
                if (ess.isBroken()) throw new IllegalStateException("This save is truncated or damaged beyond what can be cleaned.");
                Map<String, Integer> done = new HashMap<>();
                Papyrus p = ess.getPapyrus();
                for (int i = 3; i < args.length; i++) {
                    String op = args[i];
                    if (op.equals("unattached") && p != null) done.put(op, p.removeUnattachedInstances().size());
                    else if (op.equals("undefined") && p != null) done.put(op, p.removeUndefinedElements().size());
                    else if (op.equals("nonexistent")) done.put(op, ess.removeNonexistentCreated().size());
                    else if (op.equals("formlists")) done.put(op, ess.cleanseFormLists(Optional.empty())[0]);
                    else if (op.equals("havok")) done.put(op, ess.resetHavok(Optional.empty())[0]);
                }
                Path out = Paths.get(args[2]);
                Files.deleteIfExists(out);
                ESS.writeESS(ess, out, false);
                // Read the result back so a bad write is caught before anything replaces the original.
                ESS check = read(out);
                System.out.println(report(check, done));
            } else {
                throw new IllegalArgumentException("unknown command " + args[0]);
            }
            System.exit(0);
        } catch (Throwable ex) {
            String msg = ex.getMessage() == null ? ex.toString() : ex.getMessage();
            System.out.println("{\"error\":" + q(msg) + "}");
            System.exit(2);
        }
    }

    static ESS read(Path file) throws Exception {
        ModelBuilder model = new ModelBuilder(new ProgressModel(10));
        return ESS.readESS(file, model).ESS;
    }

    static String report(ESS ess, Map<String, Integer> done) {
        StringBuilder b = new StringBuilder("{");
        b.append("\"game\":").append(q(ess.getHeader().GAME.NAME));
        b.append(",\"name\":").append(q(String.valueOf(ess.getHeader().NAME)));
        b.append(",\"level\":").append(ess.getHeader().LEVEL);
        b.append(",\"location\":").append(q(String.valueOf(ess.getHeader().LOCATION)));
        b.append(",\"broken\":").append(ess.isBroken());
        b.append(",\"truncated\":").append(ess.isTruncated());
        b.append(",\"pluginOverflow\":").append(ess.isPluginOverflow());
        b.append(",\"hasCosave\":").append(ess.hasCosave());
        b.append(",\"changeForms\":").append(ess.getChangeForms() == null ? 0 : ess.getChangeForms().size());
        List<String> full = new ArrayList<>();
        List<String> lite = new ArrayList<>();
        for (Plugin pl : ess.getPluginInfo().getAllPlugins()) (pl.LIGHTWEIGHT ? lite : full).add(pl.NAME);
        b.append(",\"plugins\":").append(list(full));
        b.append(",\"lightPlugins\":").append(list(lite));
        Papyrus p = ess.getPapyrus();
        if (p != null) {
            int[] undef = p.countUndefinedElements();
            b.append(",\"papyrus\":{");
            b.append("\"scripts\":").append(p.getScripts().size());
            b.append(",\"instances\":").append(p.getScriptInstances().size());
            b.append(",\"references\":").append(p.getReferences().size());
            b.append(",\"arrays\":").append(p.getArrays().size());
            b.append(",\"activeScripts\":").append(p.getActiveScripts().size());
            b.append(",\"suspendedStacks\":").append(p.getSuspendedStacks1().size() + p.getSuspendedStacks2().size());
            b.append(",\"unattachedInstances\":").append(p.countUnattachedInstances());
            b.append(",\"undefinedElements\":").append(undef[0]);
            b.append(",\"undefinedThreads\":").append(undef[1]);
            b.append(",\"broken\":").append(p.isBroken());
            // Scripts with the most instances: the usual sign of a script-heavy mod bloating the save.
            Map<String, Integer> counts = new HashMap<>();
            for (ScriptInstance si : p.getScriptInstances().values()) counts.merge(String.valueOf(si.getScriptName()), 1, Integer::sum);
            List<Map.Entry<String, Integer>> top = new ArrayList<>(counts.entrySet());
            top.sort((x, y) -> y.getValue() - x.getValue());
            b.append(",\"topScripts\":[");
            for (int i = 0; i < Math.min(12, top.size()); i++) {
                if (i > 0) b.append(',');
                b.append("{\"script\":").append(q(top.get(i).getKey())).append(",\"instances\":").append(top.get(i).getValue()).append('}');
            }
            b.append("]}");
        }
        if (done != null) {
            b.append(",\"removed\":{");
            int i = 0;
            for (Map.Entry<String, Integer> e : done.entrySet()) {
                if (i++ > 0) b.append(',');
                b.append(q(e.getKey())).append(':').append(e.getValue());
            }
            b.append('}');
        }
        return b.append('}').toString();
    }

    static String list(List<String> items) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) b.append(',');
            b.append(q(items.get(i)));
        }
        return b.append(']').toString();
    }

    static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }
}
